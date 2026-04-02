# Workflow: cluster

<purpose>Manage Kubernetes cluster profiles: add new clusters, switch active cluster, list available clusters, or probe RDMA/GPU topology.</purpose>
<core_principle>Cluster configs live in .dev.yaml at workspace level. All features share the cluster pool; each feature can override via deploy.cluster.</core_principle>

<process>
<step name="INIT" priority="first">
Load workspace configuration and parse sub-command.

```bash
# Auto-discover devflow CLI (marketplace or local install)
DEVFLOW_BIN=$(ls ~/.claude/plugins/cache/devflow/devflow/*/skills/my-dev/bin/my-dev-tools.cjs 2>/dev/null | head -1)

INIT=$(node "$DEVFLOW_BIN" init cluster)
WORKSPACE=$(echo "$INIT" | jq -r '.workspace')
SUBCOMMAND=$(echo "$ARGUMENTS" | awk '{print $1}')  # add | use | list | probe
CLUSTER_NAME=$(echo "$ARGUMENTS" | awk '{print $2}')
```

Gate: `.dev.yaml` must exist. If not, abort: "Run `/devflow init workspace` first."
</step>

<step name="LIST">
Display all configured clusters and highlight the active one.

```bash
ACTIVE=$(echo "$INIT" | jq -r '.cluster.name')
CLUSTERS=$(echo "$INIT" | jq -r '.all_clusters | keys[]')
```

Output:
```
Clusters:
  * paigpu-a  (active)  namespace: dynamo-system  gpu: 8x H200 143GB
    paigpu-b             namespace: dynamo-system
```

If `SUBCOMMAND` is empty or `list`, display this and stop.
</step>

<step name="USE">
Switch the active cluster.

Gate: `CLUSTER_NAME` must exist in `clusters`. If not, list available and abort.

Update `.dev.yaml`:
- Set `defaults.active_cluster` to `$CLUSTER_NAME`

After switching, auto-check monitoring:
→ Execute observe.md (ensure-monitoring) for the new cluster.

Output:
```
Active cluster: $CLUSTER_NAME
Namespace: $NAMESPACE
SSH: $SSH

Features using default cluster will now target $CLUSTER_NAME.
(Features with explicit deploy.cluster are unchanged.)
```
</step>

<step name="ADD">
Add a new cluster profile interactively.

Prompt for required fields:
1. **Name**: cluster identifier (kebab-case)
2. **SSH**: SSH connection string
3. **Namespace**: Kubernetes namespace
4. **Safety**: normal | careful (careful = confirm before destructive ops)
5. **GPU** (optional): hardware description

Append to `.dev.yaml` clusters section:
```yaml
clusters:
  <name>:
    ssh: "<ssh_string>"
    namespace: "<namespace>"
    safety: <safety>
    hardware:
      gpu: "<gpu_description>"
```

After adding, auto-check monitoring:
→ Execute observe.md (ensure-monitoring) for the new cluster.

Output:
```
Cluster added: $CLUSTER_NAME
Use it: /devflow cluster use $CLUSTER_NAME
```
</step>

<step name="PROBE">
Probe RDMA/GPU topology on a cluster node to discover correct DeepEP/NVSHMEM configuration.

```
/devflow cluster probe [cluster-name]   # defaults to active_cluster
```

Gate: `CLUSTER_NAME` must exist in `clusters` and have `ssh` configured.

**Flow**:

1. Resolve cluster SSH and namespace:
```bash
TARGET_CLUSTER=${CLUSTER_NAME:-$ACTIVE}
SSH=$(echo "$INIT" | jq -r ".all_clusters.$TARGET_CLUSTER.ssh")
NAMESPACE=$(echo "$INIT" | jq -r ".all_clusters.$TARGET_CLUSTER.namespace")
```

2. Find a running GPU pod on the cluster to exec into:
```bash
POD=$($SSH "kubectl get pods -n $NAMESPACE -o jsonpath='{.items[0].metadata.name}' -l nvidia.com/gpu 2>/dev/null" || echo "")
```
If no GPU pod found, try SSH directly to a GPU node (if available).

3. Upload and execute the probe script:
```bash
PROBE_SCRIPT="$WORKSPACE/scripts/probe-rdma-topo.py"
$SSH "kubectl exec -i $POD -n $NAMESPACE -c vllm -- bash -c 'cat > /tmp/probe.py; python3 /tmp/probe.py --output json'" < "$PROBE_SCRIPT"
```

4. Parse JSON result and save to `.dev.yaml`:
```yaml
clusters:
  <cluster-name>:
    rdma_topo:
      probed_at: "<ISO timestamp>"
      probed_node: "<hostname>"
      gpu_count: <N>
      bootstrap_iface: "<iface>"
      roce_v2_gid_index: <idx>
      hca_mapping: "<DEEP_EP_DEVICE_TO_HCA_MAPPING string>"
      addr_family: "AF_INET"
      addr_range: "0.0.0.0/0"
```

5. Display results:
```
RDMA Topology for $TARGET_CLUSTER (probed on <hostname>):

  GPU → NIC Mapping (via rdma link netdev):
    GPU0 → mlx5_7  (10.83.116.20)  ACTIVE
    GPU1 → mlx5_11 (10.83.116.84)  ACTIVE
    ...

  Bootstrap: b_manage0
  RoCE v2 GID index: 3

  Saved to .dev.yaml → clusters.$TARGET_CLUSTER.rdma_topo

--- Suggested YAML env vars ---
  (paste into decode.yaml / prefill.yaml)

  <YAML env snippet from probe script>
```

6. If `--nodes node1,node2` is specified, probe multiple nodes and compare:
   - Run probe on each node
   - Compare `hca_mapping` values
   - If they differ, WARN: "Nodes have different topologies — use node affinity to separate workloads"
   - If they match: "All nodes have consistent topology ✓"

**When to probe**:
- After `/devflow cluster add` — suggest: "Run `/devflow cluster probe` to detect RDMA topology"
- Before `/devflow deploy` — if `rdma_topo` is missing from cluster config, warn: "RDMA topology not probed. Run `/devflow cluster probe` first."
</step>
</process>
