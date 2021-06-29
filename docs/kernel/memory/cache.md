# Cache

A cache is a block of high-speed memory that contains a number
of entries, each consisting of:
* Main memory address information, commonly known as a **tag**
* The associated data

Cache introduce a number of potential problems, mainly because:
* Memory accesses can occur at times other than when the
  programmer would expect them
* A data item can be held in multiple physical locations

## The cacheability and Shareability memory attributes

* **Cacheability** defines weather memory locations are allowed to be
  allocated into a cache or not
  * Inner Cacheability
  * Outer Cacheability
* **Shareability** defines whether memory locations are shareable between
  agents in a system

### Cacheability attributes for Normal memory

Cacheability only applies to Normal memory, and can be defined independently
for Inner and Outer cache locations. All types of Device memory are always
treated as Non-cacheable.

* Write-Through Cacheable
* Write-Back Cacheable
* Non-cacheable

### Shareable Normal memory

A Normal memory location has a Shareability attribute that is one of:

* Inner Shareable, meaning it applies across the Inner Shareable
  shareability domain
* Outer Shareable, meaning it applies across both the Inner Shareable
  and the Outer Shareable shareability domains.
* Non-shareable

## Conceptual points

* Point of Unification (PoU)
* Point of Coherency (PoC)
* Point of Persistence (PoP)
* Point of Persistence (PoDP)

## flush operations

* Clean: causes the contents of the cache line to be writtern back
  to memory, but only if the cache line is 'dirty'
* invalidate: simply marks a cache line as 'invalid', meaning you
  won't hit upon

* Cache clean by virtual address, `DC CVAC`, `DC CVAP`, and `DC CVAU`
* Cache invalidate by virtual address, `DC IVAC`
* Cache clean and invalidate by virtual address, `DC CIVAC`

### flush icache

`__flush_icache_range` and `__flush_cache_user_range` are used to
flush

```c
```

### flush dcache

`__flush_dcache_area` clean and invalidate cache (kaddr, size)

```c
/*
 *      __flush_dcache_area(kaddr, size)
 *
 *      Ensure that any D-cache lines for the interval [kaddr, kaddr+size)
 *      are cleaned and invalidated to the PoC.
 *
 *      - kaddr   - kernel address
 *      - size    - size in question
 */
ENTRY(__flush_dcache_area)
        dcache_by_line_op civac, sy, x0, x1, x2, x3
        ret
ENDPIPROC(__flush_dcache_area)
```