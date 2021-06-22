module.exports = {
  title: 'Hello VuePress',
  description: 'Just playing around',
  themeConfig: {
    sidebar: [
      {
        text: 'Kernel',
        children: [
          {
            text: 'Interrupt',
            children: [
              '/kernel/interrupt/its.md',
            ]
          },
          {
            text: 'Sync',
            children: [
              '/kernel/sync/wait.md',
            ]
          },
          {
            text: 'IPC',
            children: [
              '/kernel/ipc/eventfd.md',
            ]
          },
          {
            text: 'Virtualization',
            children: [
              '/kernel/virtualization/vfio.md',
            ]
          },
        ]
      }
    ]
  }
}
