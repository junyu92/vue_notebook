# Memory Tagging Extension

The extension introduces a notion of two types of tags:

* address tags
* memory tags

Every time a heap region is allocated, the software chooses a
random 4-bit tag and marks both the address and all the newly
allocated memory granules with this tag.

The load and store instructions verify that the address tag
matches the memory tag, causing a hardware exception on tag
mismatch.


## Example

When the user code requests 20 bytes of heap to be allocated,
operator new() rounds up the size to the 16-byte boundary
(i.e., to 32), allocates a 32-byte chunk of memory (i.e.,
two 16-byte memory granules), chooses a random 4-bit tag
(in this case, 0xA), puts this tag into the top-byte of the
address, and updates the tags for the two newly allocated
memory granules.

The adjacent memory regions have different memory tags, so
when the code tries to access memory at offset 32 from the
pointer, MTE raises an exception because the tag of the pointer
does not match the tag of the memory granule being accessed.