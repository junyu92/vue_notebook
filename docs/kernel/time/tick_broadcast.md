# Tick Broadcast

[[toc]]

## Introduction

Power management is an increasingly important responsibility of
almost every subsystem in the Linux kernel. One of the most
established power management mechanisms in the kernel is the
cpuidle framework which puts idle CPUs into sleeping states until
they have work to do. These sleeping states are called the "C-states"
or CPU operating states. The deeper a C-state, the more power is conserved.

However, an interesting problem surfaces when CPUs enter certain deep
C-states. Idle CPUs are typically woken up by their respective local
timers when there is work to be done, **but what happens if these CPUs**
**enter deep C-states in which these timers stop working?** Who will wake
up the CPUs in time to handle the work scheduled on them? This is where
the "tick broadcast framework" steps in. **It assigns a clock device that**
**is not affected by the C-states of the CPUs as the timer responsible for**
**handling the wakeup of all those CPUs that enter deep C-states.**

The tick broadcast framework in the kernel provides the necessary
infrastructure to handle the wakeup of such CPUs at the right time.

## Initialization

The very beginning function related to time initialization is `tick_init`.

```c
void __init tick_init(void)
{
        tick_broadcast_init();
        tick_nohz_init();
}
```

The function contains two jobs:

* `tick_broadcast_init`
* `tick_nohz_init`

```c
void __init tick_broadcast_init(void)
{
        zalloc_cpumask_var(&tick_broadcast_mask, GFP_NOWAIT);
        zalloc_cpumask_var(&tick_broadcast_on, GFP_NOWAIT);
        zalloc_cpumask_var(&tmpmask, GFP_NOWAIT);
#ifdef CONFIG_TICK_ONESHOT
        zalloc_cpumask_var(&tick_broadcast_oneshot_mask, GFP_NOWAIT);
        zalloc_cpumask_var(&tick_broadcast_pending_mask, GFP_NOWAIT);
        zalloc_cpumask_var(&tick_broadcast_force_mask, GFP_NOWAIT);
#endif
}
```

`tick_broadcast_init` allocates different cpumasks.

The first three cpumasks are:

* `tick_broadcast_mask`, the bitmap which represents list of processors
  that are in a sleeping mode;
* `tick_broadcast_on` the bitmap that stores numbers of processors which
   are in a periodic broadcast state;
* `tmpmask` this bitmap for temporary usage.

## Registering a timer as the `tick_broadcast_device`

During the initialization of the kernel, every timer in the system
registers itself as a `tick_device`.

## Tracking the CPUs in deep idle states

Now we'll return to the way the tick broadcast framework keeps
track of when to wake up the CPUs that enter idle states when
their local timers stop. Just before a CPU enters such an idle
state, it calls into the tick broadcast framework. This CPU is
then added to a list of CPUs to be woken up; specifically,
a bit is set for this CPU in a "broadcast mask".

```c
static inline void tick_broadcast_enable(void)
{
        tick_broadcast_control(TICK_BROADCAST_ON);
}
```

Then a check is made to see if the time at which this CPU has to
be woken up is prior to the time at which the tick_broadcast_device
has been currently programmed. If so, the time at which the
tick_broadcast_device should interrupt is updated to reflect the
new value and this value is programmed into the external timer.
The tick_cpu_device of the CPU that is going to deep idle state
is now put in CLOCK_EVT_MODE_SHUTDOWN mode, meaning that it is
no longer functional.

Each time a CPU goes to deep idle state, the above steps are
repeated and the tick_broadcast_device is programmed to fire
at the earliest of the wakeup times of the CPUs in deep idle states.

## Waking up the CPUs in depp idle states

When the external timer expires, it interrupts one of the online CPUs,
which scans the list of CPUs that have asked to be woken up to check
**if any of their wakeup times have been reached**.

IPIs are then sent to all the CPUs that are present in this
mask. Since wakeup interrupts are sent to a group of CPUs, this
framework is called the "broadcast" framework. The broadcast is
done in `tick_do_broadcast()` in `kernel/time/tick-broadcast.c`.

```c
static bool tick_do_broadcast(struct cpumask *mask)
{
        int cpu = smp_processor_id();
        struct tick_device *td;
        bool local = false;

        /*
         * Check, if the current cpu is in the mask
         */
        if (cpumask_test_cpu(cpu, mask)) {
                struct clock_event_device *bc = tick_broadcast_device.evtdev;

                cpumask_clear_cpu(cpu, mask);
                /*
                 * We only run the local handler, if the broadcast
                 * device is not hrtimer based. Otherwise we run into
                 * a hrtimer recursion.
                 *
                 * local timer_interrupt()
                 *   local_handler()
                 *     expire_hrtimers()
                 *       bc_handler()
                 *         local_handler()
                 *           expire_hrtimers()
                 */
                local = !(bc->features & CLOCK_EVT_FEAT_HRTIMER);
        }

        if (!cpumask_empty(mask)) {
                /*
                 * It might be necessary to actually check whether the devices
                 * have different broadcast functions. For now, just use the
                 * one of the first device. This works as long as we have this
                 * misfeature only on x86 (lapic)
                 */
                td = &per_cpu(tick_cpu_device, cpumask_first(mask));
                td->evtdev->broadcast(mask);
        }
        return local;
}
```

Every tick device has a "broadcast method" associated with it.
This method is an architecture-specific function encapsulating
the way inter-processor interrupts (IPIs) are sent to a group
of CPUs. Similarly, each local timer is also associated with
this method. The broadcast method of the local timer of one of
the CPUs in the temporary mask is invoked by passing it the same
mask.

On ARM64, the broadcast method is `tick_broadcast()` which was installed
within `tick_setup_device()`.

```c
#ifdef CONFIG_GENERIC_CLOCKEVENTS_BROADCAST
void tick_broadcast(const struct cpumask *mask)
{
        smp_cross_call(mask, IPI_TIMER);
}
#endif
```

## Reference

* [The tick broadcast framework](https://lwn.net/Articles/574962/)
* [Linux时间子系统之（十四）：tick broadcast framework](http://www.wowotech.net/timer_subsystem/tick-broadcast-framework.html)