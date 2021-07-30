# Clocksource and Timerkeeping

[[toc]]

## Introduction to clocksource

A System can own multiple clocksource.

## struct clocksource

```c
/**
 * struct clocksource - hardware abstraction for a free running counter
 *      Provides mostly state-free accessors to the underlying hardware.
 *      This is the structure used for system time.
 *
 * @name:               ptr to clocksource name
 * @list:               list head for registration
 * @rating:             rating value for selection (higher is better)
 *                      To avoid rating inflation the following
 *                      list should give you a guide as to how
 *                      to assign your clocksource a rating
 *                      1-99: Unfit for real use
 *                              Only available for bootup and testing purposes.
 *                      100-199: Base level usability.
 *                              Functional for real use, but not desired.
 *                      200-299: Good.
 *                              A correct and usable clocksource.
 *                      300-399: Desired.
 *                              A reasonably fast and accurate clocksource.
 *                      400-499: Perfect
 *                              The ideal clocksource. A must-use where
 *                              available.
 * @read:               returns a cycle value, passes clocksource as argument
 * @enable:             optional function to enable the clocksource
 * @disable:            optional function to disable the clocksource
 * @mask:               bitmask for two's complement
 *                      subtraction of non 64 bit counters
 * @mult:               cycle to nanosecond multiplier
 * @shift:              cycle to nanosecond divisor (power of two)
 * @max_idle_ns:        max idle time permitted by the clocksource (nsecs)
 * @maxadj:             maximum adjustment value to mult (~11%)
 * @max_cycles:         maximum safe cycle value which won't overflow on multiplication
 * @flags:              flags describing special properties
 * @archdata:           arch-specific data
 * @suspend:            suspend function for the clocksource, if necessary
 * @resume:             resume function for the clocksource, if necessary
 * @mark_unstable:      Optional function to inform the clocksource driver that
 *                      the watchdog marked the clocksource unstable
 * @owner:              module reference, must be set by clocksource in modules
 *
 * Note: This struct is not used in hotpathes of the timekeeping code
 * because the timekeeper caches the hot path fields in its own data
 * structure, so no line cache alignment is required,
 *
 * The pointer to the clocksource itself is handed to the read
 * callback. If you need extra information there you can wrap struct
 * clocksource into your own struct. Depending on the amount of
 * information you need you should consider to cache line align that
 * structure.
 */
struct clocksource {
        u64 (*read)(struct clocksource *cs);
        u64 mask;
        u32 mult;
        u32 shift;
        u64 max_idle_ns;
        u32 maxadj;
#ifdef CONFIG_ARCH_CLOCKSOURCE_DATA
        struct arch_clocksource_data archdata;
#endif
        u64 max_cycles;
        const char *name;
        struct list_head list;
        int rating;
        int (*enable)(struct clocksource *cs);
        void (*disable)(struct clocksource *cs);
        unsigned long flags;
        void (*suspend)(struct clocksource *cs);
        void (*resume)(struct clocksource *cs);
        void (*mark_unstable)(struct clocksource *cs);
        void (*tick_stable)(struct clocksource *cs);

        /* private: */
#ifdef CONFIG_CLOCKSOURCE_WATCHDOG
        /* Watchdog related data, used by the framework */
        struct list_head wd_list;
        u64 cs_last;
        u64 wd_last;
#endif
        struct module *owner;
};
```

### Jiffies based clocksource

Linux kernel provides a jiffies based clocksource.

```c
/*
 * The Jiffies based clocksource is the lowest common
 * denominator clock source which should function on
 * all systems. It has the same coarse resolution as
 * the timer interrupt frequency HZ and it suffers
 * inaccuracies caused by missed or lost timer
 * interrupts and the inability for the timer
 * interrupt hardware to accuratly tick at the
 * requested HZ value. It is also not recommended
 * for "tick-less" systems.
 */
static struct clocksource clocksource_jiffies = {
        .name           = "jiffies",
        .rating         = 1, /* lowest valid rating*/
        .read           = jiffies_read,
        .mask           = CLOCKSOURCE_MASK(32),
        .mult           = TICK_NSEC << JIFFIES_SHIFT, /* details above */
        .shift          = JIFFIES_SHIFT,
        .max_cycles     = 10,
};

static int __init init_jiffies_clocksource(void)
{
        return __clocksource_register(&clocksource_jiffies);
}

core_initcall(init_jiffies_clocksource)
```


### Register a clocksource

```c
static inline int clocksource_register_hz(struct clocksource *cs, u32 hz)
{
        return __clocksource_register_scale(cs, 1, hz);
}

/**
 * __clocksource_register_scale - Used to install new clocksources
 * @cs:         clocksource to be registered
 * @scale:      Scale factor multiplied against freq to get clocksource hz
 * @freq:       clocksource frequency (cycles per second) divided by scale
 *
 * Returns -EBUSY if registration fails, zero otherwise.
 *
 * This *SHOULD NOT* be called directly! Please use the
 * clocksource_register_hz() or clocksource_register_khz helper functions.
 */
int __clocksource_register_scale(struct clocksource *cs, u32 scale, u32 freq)
{
        unsigned long flags;

        clocksource_arch_init(cs);

        /* Initialize mult/shift and max_idle_ns */
        __clocksource_update_freq_scale(cs, scale, freq);

        /* Add clocksource to the clocksource list */
        mutex_lock(&clocksource_mutex);

        clocksource_watchdog_lock(&flags);
        clocksource_enqueue(cs);
        clocksource_enqueue_watchdog(cs);
        clocksource_watchdog_unlock(&flags);

        clocksource_select();
        clocksource_select_watchdog(false);
        __clocksource_suspend_select(cs);
        mutex_unlock(&clocksource_mutex);
        return 0;
}
EXPORT_SYMBOL_GPL(__clocksource_register_scale);
```


### Select a clocksource

Linux will select a preferable clocksource.

```
[    0.000000] clocksource: arch_sys_counter: mask: 0xffffffffffffff max_cycles: 0x1cd42e208c, max_idle_ns: 881590405314 ns
[    0.991761] clocksource: jiffies: mask: 0xffffffff max_cycles: 0xffffffff, max_idle_ns: 7645041785100000 ns
[    2.396419] clocksource: Switched to clocksource arch_sys_counter
```

```c
static void __clocksource_select(bool skipcur)
{
        bool oneshot = tick_oneshot_mode_active();
        struct clocksource *best, *cs;

        /* Find the best suitable clocksource */
        best = clocksource_find_best(oneshot, skipcur);
        if (!best)
                return;

        if (!strlen(override_name))
                goto found;

        /* Check for the override clocksource. */
        list_for_each_entry(cs, &clocksource_list, list) {
                if (skipcur && cs == curr_clocksource)
                        continue;
                if (strcmp(cs->name, override_name) != 0)
                        continue;
                /*
                 * Check to make sure we don't switch to a non-highres
                 * capable clocksource if the tick code is in oneshot
                 * mode (highres or nohz)
                 */
                if (!(cs->flags & CLOCK_SOURCE_VALID_FOR_HRES) && oneshot) {
                        /* Override clocksource cannot be used. */
                        if (cs->flags & CLOCK_SOURCE_UNSTABLE) {
                                pr_warn("Override clocksource %s is unstable and not HRT compatible - cannot switch while in HRT/NOHZ mode\n",
                                        cs->name);
                                override_name[0] = 0;
                        } else {
                                /*
                                 * The override cannot be currently verified.
                                 * Deferring to let the watchdog check.
                                 */
                                pr_info("Override clocksource %s is not currently HRT compatible - deferring\n",
                                        cs->name);
                        }
                } else
                        /* Override clocksource can be used. */
                        best = cs;
                break;
        }

found:
        if (curr_clocksource != best && !timekeeping_notify(best)) {
                pr_info("Switched to clocksource %s\n", best->name);
                curr_clocksource = best;
        }
}
```