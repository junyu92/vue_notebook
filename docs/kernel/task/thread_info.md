# Thread Info

## struct thread_info

```c
/*
 * low level task data that entry.S needs immediate access to.
 */
struct thread_info {
        unsigned long           flags;          /* low level flags */
#ifdef CONFIG_ARM64_SW_TTBR0_PAN
        u64                     ttbr0;          /* saved TTBR0_EL1 */
#endif
        union {
                u64             preempt_count;  /* 0 => preemptible, <0 => bug */
                struct {
#ifdef CONFIG_CPU_BIG_ENDIAN
                        u32     need_resched;
                        u32     count;
#else
                        u32     count;
                        u32     need_resched;
#endif
                } preempt;
        };
#ifdef CONFIG_SHADOW_CALL_STACK
        void                    *scs_base;
        void                    *scs_sp;
#endif
};
```

## Memory position of thread_info

thread_info is stored within either `struct task_struct` or stack.

### If thread_info is stored within `struct task_struct`

```c
struct task_struct {
#ifdef CONFIG_THREAD_INFO_IN_TASK
        /*
         * For reasons of header soup (see current_thread_info()), this
         * must be the first element of task_struct.
         */
        struct thread_info              thread_info;
#endif
	// ...
}
```