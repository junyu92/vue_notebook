# (Hardware) Timer

## Interrupt handler

```c
/*
 * Setup the device for a periodic tick
 */
void tick_setup_periodic(struct clock_event_device *dev, int broadcast)
{
        tick_set_periodic_handler(dev, broadcast);

        /* Broadcast setup ? */
        if (!tick_device_is_functional(dev))
                return;

        if ((dev->features & CLOCK_EVT_FEAT_PERIODIC) &&
            !tick_broadcast_oneshot_active()) {
                clockevents_switch_state(dev, CLOCK_EVT_STATE_PERIODIC);
        } else {
                unsigned int seq;
                ktime_t next;

                do {
                        seq = read_seqbegin(&jiffies_lock);
                        next = tick_next_period;
                } while (read_seqretry(&jiffies_lock, seq));

                clockevents_switch_state(dev, CLOCK_EVT_STATE_ONESHOT);

                for (;;) {
                        if (!clockevents_program_event(dev, next, false))
                                return;
                        next = ktime_add(next, tick_period);
                }
        }
}
```
