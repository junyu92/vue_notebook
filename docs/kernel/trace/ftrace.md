# ftrace

## events

1. list all avaiable events

```bash
cat available_events
```

2. enable tracepoints

```bash
echo 1 > ./events/kvm/kvm_entry/enable
echo 1 > ./events/kvm/kvm_exit/enable
```

3. enable tracing

```bash
echo 1 > tracing_on
```

4. display tracing information

```bash

```

## function