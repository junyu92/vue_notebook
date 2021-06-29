# GIC

## Interrupt prioritization

Prioritization describes the

* Configuration and control of interrupt priority
* Order of execution of pending interrupts
* Determination of when interrupts are visible to a target PE,
  including
  * Interrupt priority masking
  * Priority grouping
  * Preemption of an active interrupt

Priority values are an 8-bit unsigned binary number.

### Preemption

A CPU interface supports signaling of higher priority pending
interrupts to a target PE before an active interrupt completes.

A pending interrupt is only signaled if both:

* Its priority is higher than the priority mask for that CPU
  interface
* Its group prioirty is higher than of the running priority on
  the CPU interface