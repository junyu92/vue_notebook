# Statistical Profiling Extension

ARMv8.2 supports an optional extension, Statistical Profiling,
providing a statistical view of the performance characteristics of
executed instructions, which can be used by software writers to
optimize their code for better performance.

At a high level, SPE behavior consists of:

* Selection of the micro-operation to be profiled
* Marking the selected micro-operation throughout its lifetime in
  the core, indicating within the various units that it is to be
  profiled
* Storing data about the profiled micro-operation in internal
  registers during its lifetime in the core
* Following retire/abort/flush of the profiled instruction,
  recording the profile data to memory

Profiles are collected periodically, with the selection of a
micro-operation to be profiled being driven by a simple down-counter
which counts the number of speculative micro-operations dispatched,
decremented once for each micro-operation.

**When the counter reaches zero**, a micro-operation is identified
as being sampled and is profiled throughout its lifetime in the
microarchitecture.

## Registers

| Registers     | Info                                                  |
| ------------- | ----------------------------------------------------- |
| PMSCR_EL1	| Statistical Profiling Control Register EL1            |
| PMSCR_EL2	| Statistical Profiling Control Register EL2            |
| PMSCR_EL12    | Alias of the PMSCR_EL1 register, available in EL2     |
| PMSICR_EL1	| Sampling Interval Counter Register                    |
| PMSIRR_EL1	| Sampling Interval Reload Register                     |
| PMSEVFR_EL1	| Sampling Event Filter Register                        |
| PMSLATFR_EL1	| Sampling Latency Filter Registe                       |
| PMBPTR_EL1	| Profiling Buffer Write Pointer Register               |
| PMBLIMITR_EL1 | Profiling Buffer Limit Address Register               |
| PMBSR_EL1	| Profiling Buffer Status/syndrome Register             |
| PMSFCR_EL1	| Sampling Filter Control Register                      |
| PMBIDR_EL1	| Profiling Buffer ID Register                          |
| PMSIDR_EL1	| Sampling Profiling ID Register                        |

## Initialization

```c
static int arm_spe_pmu_device_probe(struct platform_device *pdev)
{
        int ret;
        struct arm_spe_pmu *spe_pmu;
        struct device *dev = &pdev->dev;

        /*
         * If kernelspace is unmapped when running at EL0, then the SPE
         * buffer will fault and prematurely terminate the AUX session.
         */
        if (arm64_kernel_unmapped_at_el0()) {
                dev_warn_once(dev, "profiling buffer inaccessible. Try passing \"kpti=off\" on the kernel command line\n");
                return -EPERM;
        }

        spe_pmu = devm_kzalloc(dev, sizeof(*spe_pmu), GFP_KERNEL);
        if (!spe_pmu) {
                dev_err(dev, "failed to allocate spe_pmu\n");
                return -ENOMEM;
        }

        spe_pmu->handle = alloc_percpu(typeof(*spe_pmu->handle));
        if (!spe_pmu->handle)
                return -ENOMEM;

        spe_pmu->pdev = pdev;
        platform_set_drvdata(pdev, spe_pmu);

        ret = arm_spe_pmu_irq_probe(spe_pmu);
        if (ret)
                goto out_free_handle;

        ret = arm_spe_pmu_dev_init(spe_pmu);
        if (ret)
                goto out_free_handle;

        ret = arm_spe_pmu_perf_init(spe_pmu);
        if (ret)
                goto out_teardown_dev;

        return 0;


out_teardown_dev:
        arm_spe_pmu_dev_teardown(spe_pmu);
out_free_handle:
        free_percpu(spe_pmu->handle);
        return ret;
}
```

```c
static int arm_spe_pmu_dev_init(struct arm_spe_pmu *spe_pmu)
{
        int ret;
        cpumask_t *mask = &spe_pmu->supported_cpus;

        /* Make sure we probe the hardware on a relevant CPU */
        ret = smp_call_function_any(mask,  __arm_spe_pmu_dev_probe, spe_pmu, 1);
        if (ret || !(spe_pmu->features & SPE_PMU_FEAT_DEV_PROBED))
                return -ENXIO;

        /* Request our PPIs (note that the IRQ is still disabled) */
        ret = request_percpu_irq(spe_pmu->irq, arm_spe_pmu_irq_handler, DRVNAME,
                                 spe_pmu->handle);
        if (ret)
                return ret;

        /*
         * Register our hotplug notifier now so we don't miss any events.
         * This will enable the IRQ for any supported CPUs that are already
         * up.
         */
        ret = cpuhp_state_add_instance(arm_spe_pmu_online,
                                       &spe_pmu->hotplug_node);
        if (ret)
                free_percpu_irq(spe_pmu->irq, spe_pmu->handle);

        return ret;
}
```

## Interrupt handler

```c
static irqreturn_t arm_spe_pmu_irq_handler(int irq, void *dev)
{
        struct perf_output_handle *handle = dev;
        struct perf_event *event = handle->event;
        enum arm_spe_pmu_buf_fault_action act;

        if (!perf_get_aux(handle))
                return IRQ_NONE;

        act = arm_spe_pmu_buf_get_fault_act(handle);
        if (act == SPE_PMU_BUF_FAULT_ACT_SPURIOUS)
                return IRQ_NONE;

        /*
         * Ensure perf callbacks have completed, which may disable the
         * profiling buffer in response to a TRUNCATION flag.
         */
        irq_work_run();

        switch (act) {
        case SPE_PMU_BUF_FAULT_ACT_FATAL:
                /*
                 * If a fatal exception occurred then leaving the profiling
                 * buffer enabled is a recipe waiting to happen. Since
                 * fatal faults don't always imply truncation, make sure
                 * that the profiling buffer is disabled explicitly before
                 * clearing the syndrome register.
                 */
                arm_spe_pmu_disable_and_drain_local();
                break;
        case SPE_PMU_BUF_FAULT_ACT_OK:
                /*
                 * We handled the fault (the buffer was full), so resume
                 * profiling as long as we didn't detect truncation.
                 * PMBPTR might be misaligned, but we'll burn that bridge
                 * when we get to it.
                 */
                if (!(handle->aux_flags & PERF_AUX_FLAG_TRUNCATED)) {
                        arm_spe_perf_aux_output_begin(handle, event);
                        isb();
                }
                break;
        case SPE_PMU_BUF_FAULT_ACT_SPURIOUS:
                /* We've seen you before, but GCC has the memory of a sieve. */
                break;
        }

        /* The buffer pointers are now sane, so resume profiling. */
        write_sysreg_s(0, SYS_PMBSR_EL1);
        return IRQ_HANDLED;
}
```

## start

```c
static void arm_spe_pmu_start(struct perf_event *event, int flags)
{
        u64 reg;
        struct arm_spe_pmu *spe_pmu = to_spe_pmu(event->pmu);
        struct hw_perf_event *hwc = &event->hw;
        struct perf_output_handle *handle = this_cpu_ptr(spe_pmu->handle);

        hwc->state = 0;
        arm_spe_perf_aux_output_begin(handle, event);
        if (hwc->state)
                return;

        reg = arm_spe_event_to_pmsfcr(event);
        write_sysreg_s(reg, SYS_PMSFCR_EL1);

        reg = arm_spe_event_to_pmsevfr(event);
        write_sysreg_s(reg, SYS_PMSEVFR_EL1);

        reg = arm_spe_event_to_pmslatfr(event);
        write_sysreg_s(reg, SYS_PMSLATFR_EL1);

        if (flags & PERF_EF_RELOAD) {
                reg = arm_spe_event_to_pmsirr(event);
                write_sysreg_s(reg, SYS_PMSIRR_EL1);
                isb();
                reg = local64_read(&hwc->period_left);
                write_sysreg_s(reg, SYS_PMSICR_EL1);
        }

        reg = arm_spe_event_to_pmscr(event);
        isb();
        write_sysreg_s(reg, SYS_PMSCR_EL1);
}
```

## stop

```c
static void arm_spe_pmu_stop(struct perf_event *event, int flags)
{
        struct arm_spe_pmu *spe_pmu = to_spe_pmu(event->pmu);
        struct hw_perf_event *hwc = &event->hw;
        struct perf_output_handle *handle = this_cpu_ptr(spe_pmu->handle);

        /* If we're already stopped, then nothing to do */
        if (hwc->state & PERF_HES_STOPPED)
                return;

        /* Stop all trace generation */
        arm_spe_pmu_disable_and_drain_local();

        if (flags & PERF_EF_UPDATE) {
                /*
                 * If there's a fault pending then ensure we contain it
                 * to this buffer, since we might be on the context-switch
                 * path.
                 */
                if (perf_get_aux(handle)) {
                        enum arm_spe_pmu_buf_fault_action act;

                        act = arm_spe_pmu_buf_get_fault_act(handle);
                        if (act == SPE_PMU_BUF_FAULT_ACT_SPURIOUS)
                                arm_spe_perf_aux_output_end(handle);
                        else
                                write_sysreg_s(0, SYS_PMBSR_EL1);
                }

                /*
                 * This may also contain ECOUNT, but nobody else should
                 * be looking at period_left, since we forbid frequency
                 * based sampling.
                 */
                local64_set(&hwc->period_left, read_sysreg_s(SYS_PMSICR_EL1));
                hwc->state |= PERF_HES_UPTODATE;
        }

        hwc->state |= PERF_HES_STOPPED;
}
```