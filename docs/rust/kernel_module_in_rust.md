# Kernel Module in Rust

[[poc]]

## Basic

### C API

```
pub extern c
```

### kernel binding

* ./rust/bindings_generated.rs



### error

Kernel error to Rust error

```rust
Error::from_kernel_errno(ret)
```

### bindgen

run `bindgen` on the kernel headers to generate automatic Rust FFI bindings.


## Wrappers

Rust for Linux framwork probides a lot of wrappers.

* Memory management
  * Allocator
* Device
  * chrdev
  * miscdev
* error
* rbtree

### Memory allocation

### Device register

#### Register

#### Deregister

```rust
impl<T: Sync> Drop for Registration<T> {
    /// Removes the registration from the kernel if it has completed successfully before.
    fn drop(&mut self) {
        if self.registered {
            unsafe { bindings::misc_deregister(&mut self.mdev) }
        }
    }
}
```
## Kernel Module

### preliminary: How the Linux Kernel Module is loaded

::: warning
TODO
:::

### Templete for Rust Kernel Module

We can build a kernel module with the following templete.

```rust
module! {
    type: KvmModule,
    name: b"rust_kvm",
    author: b"Zhang Junyu",
    license: b"GPL v2",
}

struct KvmModule;

impl KernelModule for KvmModule {
    fn init() -> Result<Self> {
        Ok(KvmModule)
    }
```

### How the Rust Kernel Module is loaded

```rust
            // Loadable modules need to export the `{{init,cleanup}}_module` identifiers
            #[cfg(MODULE)]
            #[doc(hidden)]
            #[no_mangle]
            pub extern \"C\" fn init_module() -> kernel::c_types::c_int {{
                __init()
            }}

            fn __init() -> kernel::c_types::c_int {{
                match <{type_} as kernel::KernelModule>::init() {{
                    Ok(m) => {{
                        unsafe {{
                            __MOD = Some(m);
                        }}
                        return 0;
                    }}
                    Err(e) => {{
                        return e.to_kernel_errno();
                    }}
                }}
            }}
```

### How the Rust Kernel Module manages its heap-allocated objects

```rust
            static mut __MOD: Option<{type_}> = None;
```

### Unload Rust kernel Module

```c
            #[cfg(MODULE)]
            #[doc(hidden)]
            #[no_mangle]
            pub extern \"C\" fn cleanup_module() {{
                __exit()
            }}

            fn __exit() {{
                unsafe {{
                    // Invokes `drop()` on `__MOD`, which should be used for cleanup.
                    __MOD = None;
                }}
            }}
```
