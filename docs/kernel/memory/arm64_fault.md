# ARM64 Fault

## Specification

### Fault

Types of MMU faults:

* Alignment fault on a data access
* Permission fault
* Translation fault
* Address size fault
* Synchronous External abort on a translation table walk
* Access flag fault
* TLB conflict abort

**Access flag fault**

An Access flag fault is generated only if a translation table
descriptor with the Access flag bit set to 0 is used.