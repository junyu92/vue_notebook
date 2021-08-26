# Pin

The Pin type wraps pointer types, guaranteeing that the values
behind the pointer won't be moved. For example, `Pin<&mut T>`,
`Pin<&T>`, `Pin<Box<T>>` all guarantee that `T` won't be moved
if `T: !Unpin`.

## Reference

* [Pinning](https://rust-lang.github.io/async-book/04_pinning/01_chapter.html)
* [Module std::pin](https://doc.rust-lang.org/std/pin/index.html)