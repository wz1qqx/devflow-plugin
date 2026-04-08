# Skill: grafana-setup

<purpose>Setup Grafana + Prometheus monitoring in a Kubernetes cluster. One-time infrastructure setup -- verify existing monitoring, fill gaps, confirm data flow.</purpose>
<core_principle>You need monitoring BEFORE problems happen. A deploy without observability is flying blind. Setup once, verify thoroughly, then hand off to ongoing observe workflows.</core_principle>

<process>
<step name="INIT" priority="first">
Initialize setup session and load cluster configuration.

```bash
# Auto-discover devflow CLI (marketplace or local install)
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)

INIT=$(node "$DEVFLOW_BIN" init grafana-setup)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
CLUSTER_NAME=$(echo "$INIT" | jq -r '.cluster.name')
NAMESPACE=$(echo "$INIT" | jq -r '.cluster.namespace')
SSH=$(echo "$INIT" | jq -r '.cluster.ssh')
MONITORING_NS=$(echo "$INIT" | jq -r '.monitoring.namespace // "monitoring"')
```

Gate: Cluster must be configured. If no cluster: "No cluster configured. Run `/devflow cluster add` first."
Gate: SSH access must work: `$SSH "echo ok"`. If fails: "Cannot reach cluster. Check SSH config."

Extract monitoring config from `.dev.yaml`:
```bash
REMOTE_WRITE_URL=$(echo "$INIT" | jq -r '.monitoring.remote_write_url // empty')
REMOTE_WRITE_SECRET=$(echo "$INIT" | jq -r '.monitoring.remote_write_secret // empty')
GRAFANA_URL=$(echo "$INIT" | jq -r '.monitoring.grafana_url // empty')
```
</step>

<step name="CHECK">
Verify what monitoring infrastructure already exists.

**1. Prometheus stack**:
```bash
echo "=== Checking Prometheus Stack ==="

# Check for kube-prometheus-stack or prometheus-operator
PROM_PODS=$($SSH "kubectl get pods -n $MONITORING_NS -l 'app.kubernetes.io/name=prometheus' -o json 2>/dev/null")
PROM_COUNT=$(echo "$PROM_PODS" | jq '.items | length // 0')
echo "Prometheus pods: $PROM_COUNT"

# Check for Grafana
GRAFANA_PODS=$($SSH "kubectl get pods -n $MONITORING_NS -l 'app.kubernetes.io/name=grafana' -o json 2>/dev/null")
GRAFANA_COUNT=$(echo "$GRAFANA_PODS" | jq '.items | length // 0')
echo "Grafana pods: $GRAFANA_COUNT"

# Check for alertmanager
ALERT_PODS=$($SSH "kubectl get pods -n $MONITORING_NS -l 'app.kubernetes.io/name=alertmanager' -o json 2>/dev/null")
ALERT_COUNT=$(echo "$ALERT_PODS" | jq '.items | length // 0')
echo "Alertmanager pods: $ALERT_COUNT"
```

**2. PodMonitors and ServiceMonitors**:
```bash
echo "=== Checking Monitors ==="

# PodMonitors in target namespace
PODMON=$($SSH "kubectl get podmonitors -n $NAMESPACE -o json 2>/dev/null")
PODMON_COUNT=$(echo "$PODMON" | jq '.items | length // 0')
echo "PodMonitors in $NAMESPACE: $PODMON_COUNT"

# ServiceMonitors in target namespace
SVCMON=$($SSH "kubectl get servicemonitors -n $NAMESPACE -o json 2>/dev/null")
SVCMON_COUNT=$(echo "$SVCMON" | jq '.items | length // 0')
echo "ServiceMonitors in $NAMESPACE: $SVCMON_COUNT"
```

**3. Remote-write secret** (if configured):
```bash
if [ -n "$REMOTE_WRITE_SECRET" ]; then
  SECRET_EXISTS=$($SSH "kubectl get secret $REMOTE_WRITE_SECRET -n $MONITORING_NS -o name 2>/dev/null")
  if [ -n "$SECRET_EXISTS" ]; then
    echo "Remote-write secret: EXISTS"
  else
    echo "Remote-write secret: MISSING ($REMOTE_WRITE_SECRET)"
  fi
fi
```

**4. Data flow verification**:
```bash
# Check if Prometheus is scraping targets
TARGETS=$($SSH "kubectl exec -n $MONITORING_NS deploy/prometheus-kube-prometheus-prometheus -- \
  wget -qO- http://localhost:9090/api/v1/targets 2>/dev/null" | jq '.data.activeTargets | length // 0')
echo "Active scrape targets: $TARGETS"
```

Produce gap report:
```
Monitoring Check: $CLUSTER_NAME
  Prometheus:    [OK/MISSING]
  Grafana:       [OK/MISSING]
  Alertmanager:  [OK/MISSING]
  PodMonitors:   $PODMON_COUNT in $NAMESPACE
  ServiceMonitors: $SVCMON_COUNT in $NAMESPACE
  Remote-write:  [OK/MISSING/NOT_CONFIGURED]
  Scrape targets: $TARGETS active

Gaps: <list of missing components>
```

If no gaps: "Monitoring stack is complete. Use `/devflow observe` for ongoing monitoring."
If gaps found: proceed to SETUP.
</step>

<step name="SETUP">
Install or repair missing monitoring components.

**1. Install kube-prometheus-stack** (if Prometheus or Grafana missing):
```bash
# Add helm repo
$SSH "helm repo add prometheus-community https://prometheus-community.github.io/helm-charts"
$SSH "helm repo update"

# Install kube-prometheus-stack
$SSH "helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace $MONITORING_NS \
  --create-namespace \
  --set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false \
  --set prometheus.prometheusSpec.podMonitorSelectorNilUsesHelmValues=false \
  --wait \
  --timeout 5m"
```

Key settings:
- `serviceMonitorSelectorNilUsesHelmValues=false`: discover all ServiceMonitors, not just helm-managed
- `podMonitorSelectorNilUsesHelmValues=false`: discover all PodMonitors

**2. Configure remote-write** (if URL configured but not set up):
```bash
if [ -n "$REMOTE_WRITE_URL" ]; then
  # Create secret if missing
  if [ -z "$SECRET_EXISTS" ] && [ -n "$REMOTE_WRITE_SECRET" ]; then
    echo "Creating remote-write secret..."
    echo "Provide remote-write credentials (username:password or token):"
    # AskUserQuestion for credentials
  fi

  # Patch Prometheus to enable remote-write
  $SSH "kubectl patch prometheus -n $MONITORING_NS kube-prometheus-stack-prometheus \
    --type merge \
    -p '{\"spec\":{\"remoteWrite\":[{\"url\":\"$REMOTE_WRITE_URL\",\"basicAuth\":{\"username\":{\"name\":\"$REMOTE_WRITE_SECRET\",\"key\":\"username\"},\"password\":{\"name\":\"$REMOTE_WRITE_SECRET\",\"key\":\"password\"}}}]}}'"
fi
```

**3. Wait for readiness**:
```bash
echo "Waiting for monitoring pods..."
$SSH "kubectl wait --for=condition=ready pod -l 'app.kubernetes.io/name=prometheus' -n $MONITORING_NS --timeout=180s"
$SSH "kubectl wait --for=condition=ready pod -l 'app.kubernetes.io/name=grafana' -n $MONITORING_NS --timeout=180s"
```
</step>

<step name="VERIFY">
Confirm the monitoring stack is functional end-to-end.

**1. Prometheus health**:
```bash
PROM_HEALTHY=$($SSH "kubectl exec -n $MONITORING_NS deploy/prometheus-kube-prometheus-prometheus -- \
  wget -qO- http://localhost:9090/-/healthy 2>/dev/null")
echo "Prometheus health: $PROM_HEALTHY"
```

**2. Grafana accessibility**:
```bash
GRAFANA_SVC=$($SSH "kubectl get svc -n $MONITORING_NS -l 'app.kubernetes.io/name=grafana' -o jsonpath='{.items[0].metadata.name}'")
GRAFANA_PORT=$($SSH "kubectl get svc -n $MONITORING_NS $GRAFANA_SVC -o jsonpath='{.spec.ports[0].port}'")
echo "Grafana service: $GRAFANA_SVC:$GRAFANA_PORT"
echo "Port-forward: kubectl port-forward -n $MONITORING_NS svc/$GRAFANA_SVC $GRAFANA_PORT"
```

**3. Scrape verification**:
```bash
# Verify targets are being scraped in target namespace
NAMESPACE_TARGETS=$($SSH "kubectl exec -n $MONITORING_NS deploy/prometheus-kube-prometheus-prometheus -- \
  wget -qO- 'http://localhost:9090/api/v1/targets?state=active' 2>/dev/null" \
  | jq "[.data.activeTargets[] | select(.labels.namespace == \"$NAMESPACE\")] | length")
echo "Targets in $NAMESPACE: $NAMESPACE_TARGETS"
```

**4. Remote-write check** (if configured):
```bash
if [ -n "$REMOTE_WRITE_URL" ]; then
  # Check for remote-write errors in prometheus logs
  RW_ERRORS=$($SSH "kubectl logs -n $MONITORING_NS deploy/prometheus-kube-prometheus-prometheus --tail=50 2>/dev/null" \
    | grep -c "remote_write" || echo "0")
  echo "Remote-write log mentions: $RW_ERRORS (check for errors if >0)"
fi
```

Output:
```
Monitoring Setup: $CLUSTER_NAME
  Prometheus: HEALTHY ($TARGETS active targets)
  Grafana: $GRAFANA_SVC:$GRAFANA_PORT
  Remote-write: [OK/ERROR/NOT_CONFIGURED]
  Namespace coverage: $NAMESPACE_TARGETS targets in $NAMESPACE

Setup complete. Use /devflow observe for ongoing monitoring.
```

Checkpoint:
```bash
node "$DEVFLOW_BIN" checkpoint \
  --action "grafana-setup" \
  --summary "Monitoring setup: $CLUSTER_NAME ($MONITORING_NS)"
```
</step>
</process>

<anti_rationalization>

## Anti-Rationalization Table

| Temptation | Reality Check |
|---|---|
| "We'll add monitoring when we need it" | You need monitoring BEFORE problems happen. After is too late. |
| "The default Prometheus config is fine" | Check serviceMonitorSelectorNilUsesHelmValues. Default misses custom monitors. |
| "Grafana is just dashboards" | Grafana is your incident response interface. No dashboards = blind debugging. |
| "Remote-write can wait" | Local Prometheus storage is ephemeral. Pod restart = data loss. |
| "I'll check the metrics later" | Verify scrape targets NOW. Misconfigured monitors silently produce no data. |

## Red Flags

- Prometheus running but zero scrape targets in application namespace
- Remote-write configured but secret missing (silent failure)
- PodMonitor/ServiceMonitor created but Prometheus not discovering them
- Grafana accessible but no datasource configured
- Monitoring namespace different from what .dev.yaml specifies

## Verification Checklist

- [ ] Prometheus pods healthy and ready
- [ ] Grafana pods healthy and accessible
- [ ] Scrape targets active in application namespace
- [ ] PodMonitors/ServiceMonitors discovered
- [ ] Remote-write functional (if configured)
- [ ] Port-forward command documented for access

</anti_rationalization>
