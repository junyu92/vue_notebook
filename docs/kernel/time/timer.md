# Dynamic Timer

[[toc]]

## Introduction

After initializing tick broadcast and NO_HZ mode (within `tick_init()`),
`init_timers` will be invoked.

In this chapter, we are going to introduce timer.

::: warning
Sometimes called kernel timers or timers.

It is often used to delay execution of some function,
not hardware timer.
:::

## Timer Initialization

```c
static void __init init_timer_cpus(void)
{
        int cpu;

        for_each_possible_cpu(cpu)
                init_timer_cpu(cpu);
}

void __init init_timers(void)
{
        init_timer_cpus();
        open_softirq(TIMER_SOFTIRQ, run_timer_softirq);
}
```

The first function is `init_timer_cpus()`, it just calls `init_timer_cpu`
for each possible cpu.

```c
struct timer_base {
        raw_spinlock_t          lock;
        struct timer_list       *running_timer;
#ifdef CONFIG_PREEMPT_RT
        spinlock_t              expiry_lock;
        atomic_t                timer_waiters;
#endif
	// earliest expiration time
        unsigned long           clk;
	// next pending time for a next timer interrupt in a case
	// when a processor goes to sleep and the NO_HZ mode is
	// enabled in the Linux kernel
        unsigned long           next_expiry;
        unsigned int            cpu;
        bool                    is_idle;
        bool                    must_forward_clk;
        DECLARE_BITMAP(pending_map, WHEEL_SIZE);
        struct hlist_head       vectors[WHEEL_SIZE];
} ____cacheline_aligned;

static void __init init_timer_cpu(int cpu)
{
        struct timer_base *base;
        int i;

        for (i = 0; i < NR_BASES; i++) {
                base = per_cpu_ptr(&timer_bases[i], cpu);
                base->cpu = cpu;
                raw_spin_lock_init(&base->lock);
                base->clk = jiffies;
                timer_base_init_expiry_lock(base);
        }
}
```

`open_softirq(TIMER_SOFTIRQ, run_timer_softirq);` registers handler
for `TIMER_SOFIRQ`.

This will be called after a hardware interrupt happened. The main point
of this function is to handle a software dynamic timer.

The Linux kernel does not do this thing during the hardware timer
interrupt handling since it's time comsuming operation.

```c
/*
 * This function runs timers and the timer-tq in bottom half context.
 */
static __latent_entropy void run_timer_softirq(struct softirq_action *h)
{
        struct timer_base *base = this_cpu_ptr(&timer_bases[BASE_STD]);

        __run_timers(base);
        if (IS_ENABLED(CONFIG_NO_HZ_COMMON))
                __run_timers(this_cpu_ptr(&timer_bases[BASE_DEF]));
}
```

`__run_timers` runs all expired events for a given processor.

```c
static inline void __run_timers(struct timer_base *base)
{
        struct hlist_head heads[LVL_DEPTH];
        int levels;

        if (!time_after_eq(jiffies, base->clk))
                return;

        timer_base_lock_expiry(base);
        raw_spin_lock_irq(&base->lock);

        /*
         * timer_base::must_forward_clk must be cleared before running
         * timers so that any timer functions that call mod_timer() will
         * not try to forward the base. Idle tracking / clock forwarding
         * logic is only used with BASE_STD timers.
         *
         * The must_forward_clk flag is cleared unconditionally also for
         * the deferrable base. The deferrable base is not affected by idle
         * tracking and never forwarded, so clearing the flag is a NOOP.
         *
         * The fact that the deferrable base is never forwarded can cause
         * large variations in granularity for deferrable timers, but they
         * can be deferred for long periods due to idle anyway.
         */
        base->must_forward_clk = false;

        while (time_after_eq(jiffies, base->clk)) {

                levels = collect_expired_timers(base, heads);
                base->clk++;

                while (levels--)
                        expire_timers(base, heads + levels);
        }
        raw_spin_unlock_irq(&base->lock);
        timer_base_unlock_expiry(base);
}

static void expire_timers(struct timer_base *base, struct hlist_head *head)
{
        /*
         * This value is required only for tracing. base->clk was
         * incremented directly before expire_timers was called. But expiry
         * is related to the old base->clk value.
         */
        unsigned long baseclk = base->clk - 1;

        while (!hlist_empty(head)) {
                struct timer_list *timer;
                void (*fn)(struct timer_list *);

                timer = hlist_entry(head->first, struct timer_list, entry);

                base->running_timer = timer;
                detach_timer(timer, true);

                fn = timer->function;

                if (timer->flags & TIMER_IRQSAFE) {
                        raw_spin_unlock(&base->lock);
                        call_timer_fn(timer, fn, baseclk);
                        base->running_timer = NULL;
                        raw_spin_lock(&base->lock);
                } else {
                        raw_spin_unlock_irq(&base->lock);
                        call_timer_fn(timer, fn, baseclk);
                        base->running_timer = NULL;
                        timer_sync_wait_running(base);
                        raw_spin_lock_irq(&base->lock);
                }
        }
}
```

## Usage

To use a timer in the Linux kernel, we must define and initialize a
variable with type `timer_list`

```c
#define DEFINE_TIMER(_name, _function)                          \
        struct timer_list _name =                               \
                __TIMER_INITIALIZER(_function, 0)
```

After initializing a dynamic timer, we can start or stop it with
`add_timer`/`del_timer`.

::: tip
There are many ways to define timer, see

include/linux/timer.h

for more details
:::

## Reference

* [Timers and time management in the Linux kernel. Part 4](https://0xax.gitbooks.io/linux-insides/content/Timers/linux-timers-4.html)