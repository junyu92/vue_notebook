module.exports = {
  title: 'Notebook',
  base: '/vue_notebook/',
  themeConfig: {
    sidebar: [
      {
        text: 'Kernel',
        children: [
          {
            text: 'Booting and Initialization',
            children: [
              '/kernel/boot/entry.md',
              '/kernel/boot/kaslr.md',
            ]
          },
          {
            text: 'Memory Management',
            children: [
              '/kernel/memory/memory_order.md',
              '/kernel/memory/cache.md',
              '/kernel/memory/memory_tagging_extension.md',
              '/kernel/memory/arm64_fault.md',
              '/kernel/memory/virtualization.md'
            ]
          },
          {
            text: 'Task',
            children: [
              '/kernel/task/idle.md',
              '/kernel/task/thread_info.md'
            ]
          },
          {
            text: 'Scheduler',
            children: [
            ]
          },
          {
            text: 'Syscall',
            children: [
              '/kernel/syscall/vdso.md',
            ]
          },
          {
            text: 'Interrupt Management',
            children: [
              '/kernel/interrupt/interrupt_in_linux.md',
              '/kernel/interrupt/gic.md',
              '/kernel/interrupt/its.md',
            ]
          },
          {
            text: 'Time Management',
            children: [
              '/kernel/time/time_in_linux.md',
              '/kernel/time/clocksource_and_timekeeping.md',
              '/kernel/time/jiffies.md',
              '/kernel/time/clockevents.md',
              '/kernel/time/timer.md',
              '/kernel/time/hrtimer.md',
              '/kernel/time/dynamic_timer.md',
              '/kernel/time/tick_broadcast.md',
            ]
          },
          {
            text: 'IPC',
            children: [
              '/kernel/ipc/signal.md',
              '/kernel/ipc/wait.md',
              '/kernel/ipc/eventfd.md',
            ]
          },
          {
            text: 'Synchronization',
            children: [
              '/kernel/sync/spinlock.md',
              '/kernel/sync/mutex.md',
              '/kernel/sync/semaphore.md',
              '/kernel/sync/rcu.md',
            ]
          },
          {
            text: 'Device Driver',
            children: [
              '/kernel/driver/pci.md'
            ]
          },
          {
            text: 'Power Management',
            children: [
              '/kernel/power/psci.md',
            ]
          },
          {
            text: 'Trace',
            children: [
              '/kernel/trace/lockup.md',
              '/kernel/trace/walk_stack_on_arm.md',
              '/kernel/trace/aarch64_debug.md',
              '/kernel/trace/pmu.md',
              '/kernel/trace/spe.md',
              '/kernel/trace/kprobes.md',
              '/kernel/trace/ftrace.md',
            ]
          },
          {
            text: 'Misc',
            children: [
              '/kernel/misc/rseq.md',
              '/kernel/misc/export_symbol.md',
              '/kernel/misc/uefi.md',
              '/kernel/misc/dtb.md',
            ]
          },
          {
            text: 'Virtualization',
            children: [
              '/kernel/virtualization/vfio.md',
              '/kernel/virtualization/secure_virt.md',
            ]
          },
        ]
      },
      {
        text: 'Rust',
        children: [
          '/rust/index.md',
          '/rust/trait.md',
          '/rust/pin.md',
          '/rust/kernel_module_in_rust.md',
        ]
      },
      {
        text: 'Debug',
        children: [
          '/debug/gdb_python.md',
        ]
      },
      {
        text: 'Qemu',
        children: [
          '/qemu/pci.md'
        ]
      },
      {
        text: 'trusted computing',
        children: [
          '/trusted_computing/sgx.md',
        ]
      }
    ],
    sidebarDepth: 0,
    disableAllHeaders: true,
  },
  plugins: [
    '@vuepress/back-to-top',
  ]
}