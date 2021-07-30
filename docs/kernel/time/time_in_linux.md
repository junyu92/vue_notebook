# Time Framework in Linux

```
    +--------------------------+  +---------------+
    | tick broadcast framework |  | dynamic timer |
    +--------------------------+  +---------------+
                       |              |
                       |   +----------+
                       |   |
                +-------------+  +---------+     +-------------+
                | tick_device |  | hrtimer |     | timekeeping |
                +-------------+  +---------+     +-------------+
                       |              |                 |
                       |   +----------+                 |
                       |   |                            |
                +-------------+                  +-------------+
                | clock_event |                  | clocksource |
                +-------------+                  +-------------+
                       |                                |
Software               |                                |
-------------------------------------------------------------------------
Hardware               |                                |
                       |                                |
            +------------------------+    +------------------------------+
            | generic timer(per-cpu) |    | counter(cntvct_el0 register) |
            +------------------------+    +------------------------------+
```

## Clocksource

The purpose of the clock source is to provide a timeline for the system that
tells you where you are in time. For example issuing the command 'date' on
a Linux system will eventually read the clock source to determine exactly
what time it is.


## Clockevent

Clockevents take a desired time specification value and calculate the values
to poke into hardware timer registers.

The hardware driving clock events has to be able to fire interrupts, so
as to trigger events on the system timeline. On an SMP system, it is ideal
(and customary) to have one such event driving timer per CPU core, so that
each core can trigger events independently of any other core.