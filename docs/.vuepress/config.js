module.exports = {
  title: 'Hello VuePress',
  description: 'Just playing around',
  themeConfig: {
    sidebar: [
      {
        title: 'Kernel',
        children: [
          {
            title: 'Interrupt',
            children: [
              '/kernel/interrupt/its',
            ]
          }
        ]
      }
    ]
  }
}
