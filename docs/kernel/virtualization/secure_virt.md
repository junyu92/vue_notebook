# Secure Virtualization

When Armv8.4-A was introduced, support for EL2 in Secure state
was added as an optional feature.

When a processor supports Secure EL2, the processor needs to
be enabled from EL3 using the `SCR_EL3.EEL2` bit. Setting this
bit enables entry into EL2, and enables use of the virtualization
features in Secure state.

## Secure EL2 and the two Intermediate Physical Address spaces

The Arm architecture defines two physical address spaces: Secure
and Non-secure. In Non-secure state, the output of the stage 1
translation of a virtual machine (VM) is always Non-secure.
Therefore, there is a single Intermediate Physical Address (IPA)
space for stage 2 to handle.

In Secure state, the stage 1 translation of a VM can output both
Secure and Non-secure addresses. The NS bit in the translation
table descriptors controls whether the Secure or the Non-secure
address space is outputted.

Unlike the stage 1 tables, there is no NS bit in the stage 2
table entries. For a particular IPA space, all translations
result in either a Secure Physical Address or a Non-secure
Physical Address. This translation is controlled by a register
bit. Typically, the Non-secure IPAs translate to Non-secure PAs,
and the Secure IPAs translate to Secure PAs.