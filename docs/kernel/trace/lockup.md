# lockup detection

The linux kernel can act as a watchdog to detect both soft
and hard lockups.

* soft lockup: bug that cuases the kernel to loop in kernel mode
  for more than 20 seconds, without giving other tasks a chance
  to run
* hard lockup: bug that causes the CPU to loop in kernel mode
  for more than 10 seconds, without letting other interrupts
  have a chance to run

Soft lockup is built upon hrtimer, hard lockup is built upon nmi.

## Soft lockup

The watchdog task is a high priority kernel thread that updates a
timestamp every time it is scheduled. If that timestamp is not updated
for 2*watchdog_thresh seconds (the softlockup threshold) the
'softlockup detector' (coded inside the hrtimer callback function)
will dump useful debug information to the system log, after which it
will call panic if it was instructed to do so or resume execution of
other kernel code.

### detect

Soft lockup is detected within the handler of hrtimer.

```c
static enum hrtimer_restart watchdog_timer_fn(struct hrtimer *hrtimer)
{
        unsigned long touch_ts = __this_cpu_read(watchdog_touch_ts);
        struct pt_regs *regs = get_irq_regs();
        int duration;
        int softlockup_all_cpu_backtrace = sysctl_softlockup_all_cpu_backtrace;

        if (!watchdog_enabled)
                return HRTIMER_NORESTART;

        /* kick the hardlockup detector */
        watchdog_interrupt_count();

        /* kick the softlockup detector */
        if (completion_done(this_cpu_ptr(&softlockup_completion))) {
                reinit_completion(this_cpu_ptr(&softlockup_completion));
                stop_one_cpu_nowait(smp_processor_id(),
                                softlockup_fn, NULL,
                                this_cpu_ptr(&softlockup_stop_work));
        }

        /* .. and repeat */
        hrtimer_forward_now(hrtimer, ns_to_ktime(sample_period));

        if (touch_ts == 0) {
                if (unlikely(__this_cpu_read(softlockup_touch_sync))) {
                        /*
                         * If the time stamp was touched atomically
                         * make sure the scheduler tick is up to date.
                         */
                        __this_cpu_write(softlockup_touch_sync, false);
                        sched_clock_tick();
                }

                /* Clear the guest paused flag on watchdog reset */
                kvm_check_and_clear_guest_paused();
                __touch_watchdog();
                return HRTIMER_RESTART;
        }

        /* check for a softlockup
         * This is done by making sure a high priority task is
         * being scheduled.  The task touches the watchdog to
         * indicate it is getting cpu time.  If it hasn't then
         * this is a good indication some task is hogging the cpu
         */
        duration = is_softlockup(touch_ts);
        if (unlikely(duration)) {
                /*
                 * If a virtual machine is stopped by the host it can look to
                 * the watchdog like a soft lockup, check to see if the host
                 * stopped the vm before we issue the warning
                 */
                if (kvm_check_and_clear_guest_paused())
                        return HRTIMER_RESTART;

                /* only warn once */
                if (__this_cpu_read(soft_watchdog_warn) == true) {
                        /*
                         * When multiple processes are causing softlockups the
                         * softlockup detector only warns on the first one
                         * because the code relies on a full quiet cycle to
                         * re-arm.  The second process prevents the quiet cycle
                         * and never gets reported.  Use task pointers to detect
                         * this.
                         */
                        if (__this_cpu_read(softlockup_task_ptr_saved) !=
                            current) {
                                __this_cpu_write(soft_watchdog_warn, false);
                                __touch_watchdog();
                        }
                        return HRTIMER_RESTART;
                }

                if (softlockup_all_cpu_backtrace) {
                        /* Prevent multiple soft-lockup reports if one cpu is already
                         * engaged in dumping cpu back traces
                         */
                        if (test_and_set_bit(0, &soft_lockup_nmi_warn)) {
                                /* Someone else will report us. Let's give up */
                                __this_cpu_write(soft_watchdog_warn, true);
                                return HRTIMER_RESTART;
                        }
                }

                pr_emerg("BUG: soft lockup - CPU#%d stuck for %us! [%s:%d]\n",
                        smp_processor_id(), duration,
                        current->comm, task_pid_nr(current));
                __this_cpu_write(softlockup_task_ptr_saved, current);
                print_modules();
                print_irqtrace_events(current);
                if (regs)
                        show_regs(regs);
                else
                        dump_stack();

                if (softlockup_all_cpu_backtrace) {
                        /* Avoid generating two back traces for current
                         * given that one is already made above
                         */
                        trigger_allbutself_cpu_backtrace();

                        clear_bit(0, &soft_lockup_nmi_warn);
                        /* Barrier to sync with other cpus */
                        smp_mb__after_atomic();
                }

                add_taint(TAINT_SOFTLOCKUP, LOCKDEP_STILL_OK);
                if (softlockup_panic)
                        panic("softlockup: hung tasks");
                __this_cpu_write(soft_watchdog_warn, true);
        } else
                __this_cpu_write(soft_watchdog_warn, false);

        return HRTIMER_RESTART;
}
```

### timeout

```c
static int is_softlockup(unsigned long touch_ts)
{
        unsigned long now = get_timestamp();

        if ((watchdog_enabled & SOFT_WATCHDOG_ENABLED) && watchdog_thresh){
                /* Warn about unreasonable delays. */
                if (time_after(now, touch_ts + get_softlockup_thresh()))
                        return now - touch_ts;
        }
        return 0;
}
```

## Hard lockup

A periodic hrtimer runs to generate interrupts and kick the watchdog
task. An NMI perf event is generated every "watchdog_thresh"
(compile-time initialized to 10 and configurable through sysctl of the
same name) seconds to check for hardlockups. If any CPU in the system
does not receive any hrtimer interrupt during that time the
'hardlockup detector' (the handler for the NMI perf event) will
generate a kernel warning or call panic, depending on the
configuration.

### initialize

```c
static int hardlockup_detector_event_create(void)
{
        unsigned int cpu = smp_processor_id();
        struct perf_event_attr *wd_attr;
        struct perf_event *evt;

        wd_attr = &wd_hw_attr;
        wd_attr->sample_period = hw_nmi_get_sample_period(watchdog_thresh);

        /* Try to register using hardware perf events */
        evt = perf_event_create_kernel_counter(wd_attr, cpu, NULL,
                                               watchdog_overflow_callback, NULL);
        if (IS_ERR(evt)) {
                pr_debug("Perf event create on CPU %d failed with %ld\n", cpu,
                         PTR_ERR(evt));
                return PTR_ERR(evt);
        }
        this_cpu_write(watchdog_ev, evt);
        return 0;
}
```

### feed

```c
static void watchdog_interrupt_count(void)
{
        __this_cpu_inc(hrtimer_interrupts);
}

/* watchdog kicker functions */
static enum hrtimer_restart watchdog_timer_fn(struct hrtimer *hrtimer)
{
        unsigned long touch_ts = __this_cpu_read(watchdog_touch_ts);
        struct pt_regs *regs = get_irq_regs();
        int duration;
        int softlockup_all_cpu_backtrace = sysctl_softlockup_all_cpu_backtrace;

        // ...

        /* kick the hardlockup detector */
        watchdog_interrupt_count();

	// ...
}
```

### timeout

If the `hrtimer_interrupts` was not updated, a hard lockup happended.

```c
/* watchdog detector functions */
bool is_hardlockup(void)
{
        unsigned long hrint = __this_cpu_read(hrtimer_interrupts);

        if (__this_cpu_read(hrtimer_interrupts_saved) == hrint)
                return true;

        __this_cpu_write(hrtimer_interrupts_saved, hrint);
        return false;
}
```

### detect

```c
static void watchdog_overflow_callback(struct perf_event *event,
                                       struct perf_sample_data *data,
                                       struct pt_regs *regs)
{
        /* Ensure the watchdog never gets throttled */
        event->hw.interrupts = 0;

        if (__this_cpu_read(watchdog_nmi_touch) == true) {
                __this_cpu_write(watchdog_nmi_touch, false);
                return;
        }

        if (!watchdog_check_timestamp())
                return;

        /* check for a hardlockup
         * This is done by making sure our timer interrupt
         * is incrementing.  The timer interrupt should have
         * fired multiple times before we overflow'd.  If it hasn't
         * then this is a good indication the cpu is stuck
         */
        if (is_hardlockup()) {
                int this_cpu = smp_processor_id();

                /* only print hardlockups once */
                if (__this_cpu_read(hard_watchdog_warn) == true)
                        return;

                pr_emerg("Watchdog detected hard LOCKUP on cpu %d\n",
                         this_cpu);
                print_modules();
                print_irqtrace_events(current);
                if (regs)
                        show_regs(regs);
                else
                        dump_stack();

                /*
                 * Perform all-CPU dump only once to avoid multiple hardlockups
                 * generating interleaving traces
                 */
                if (sysctl_hardlockup_all_cpu_backtrace &&
                                !test_and_set_bit(0, &hardlockup_allcpu_dumped))
                        trigger_allbutself_cpu_backtrace();

                if (hardlockup_panic)
                        nmi_panic(regs, "Hard LOCKUP");

                __this_cpu_write(hard_watchdog_warn, true);
                return;
        }

        __this_cpu_write(hard_watchdog_warn, false);
        return;
}
```