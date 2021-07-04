# AArch64 Debug

## ARM debug hardware

**Invasive debug** provides facilities that enable you to stop programs
and step through them line by line.

### Software/Hardware breakpoint

* Software breakpoint

The HLT instruction causes the core to enter debug state if an
external debugger is connected and relevant security permissions
permit entry to debug state.

The BRK instruction in AArch64 generates a synchronous debug exception
but does not cause the core to enter debug state.

**Software can only be used on code that is stored in RAM.**

* Hardware breakpoint

Hardware breakpoints use comparators built into the core and stop
execution when execution reaches the specified address. These can
be **used anywhere in memory**, as they do not require changes to code,
but the hardware provides limited numbers of hardware breakpoint units.

The Cortex-A57 processor, for example, has six hardware breakpoints
and four watchpoints available in hardware resources. See the Debug
ID Register (DBGDIDR) to obtain these values for a given implementation.

### Halt or Self-hosted debug

**In halting debug, the debug event causes the core to enter debug state.**

In debug state, the core is halted, meaning that it no longer fetches
instructions. Instead, the core executes instructions under the
direction of a debugger running on a different host connected through
JTAG, or another external interface.

The basic principles of halting debug is:
* When programmed for halting debug, a debug event causes entry to a
  special Debug state.
* In Debug state, the core does not fetch instructions from memory, but
  from a special Instruction Transfer Register.
* Data Transfer Registers are used to move register and memory content
  between host and target.

**In monitor debug, the debug event causes a debug exception to be raised.**
The exception must be handled by dedicated debug monitor software running
on the same core. Monitor debug presupposes software support.

## ARM trace hardware

**Non-invasive debug** enables observation of the core behavior while
it is executing.

It is possible to record memory accesses performed (including address
and data values) and generate a real-time trace of the program, seeing
peripheral accesses, stack and heap accesses and changes to variables.

### Embedded Trace Macrocell (ETM)

In some cases, there is one ETM per core. System-on-Chip designers can
omit this block from their silicon to reduce costs. These blocks observe,
but do not affect, core behavior and are able to monitor instruction
execution and data accesses.