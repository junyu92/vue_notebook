"use strict";(self.webpackChunknotebook=self.webpackChunknotebook||[]).push([[6184],{9896:(e,n,a)=>{a.r(n),a.d(n,{data:()=>s});const s={key:"v-143255b6",path:"/kernel/time/time_in_linux.html",title:"Time Framework in Linux",lang:"en-US",frontmatter:{},excerpt:"",headers:[{level:2,title:"Clocksource",slug:"clocksource",children:[]},{level:2,title:"Clockevent",slug:"clockevent",children:[]}],filePathRelative:"kernel/time/time_in_linux.md",git:{updatedTime:1627640859e3,contributors:[{name:"Zhang Junyu",email:"zhangjunyu.92@bytedance.com",commits:1}]}}},8046:(e,n,a)=>{a.r(n),a.d(n,{default:()=>r});const s=(0,a(6252).uE)('<h1 id="time-framework-in-linux" tabindex="-1"><a class="header-anchor" href="#time-framework-in-linux" aria-hidden="true">#</a> Time Framework in Linux</h1><div class="language-text ext-text line-numbers-mode"><pre class="language-text"><code>    +--------------------------+  +---------------+\n    | tick broadcast framework |  | dynamic timer |\n    +--------------------------+  +---------------+\n                       |              |\n                       |   +----------+\n                       |   |\n                +-------------+  +---------+     +-------------+\n                | tick_device |  | hrtimer |     | timekeeping |\n                +-------------+  +---------+     +-------------+\n                       |              |                 |\n                       |   +----------+                 |\n                       |   |                            |\n                +-------------+                  +-------------+\n                | clock_event |                  | clocksource |\n                +-------------+                  +-------------+\n                       |                                |\nSoftware               |                                |\n-------------------------------------------------------------------------\nHardware               |                                |\n                       |                                |\n            +------------------------+    +------------------------------+\n            | generic timer(per-cpu) |    | counter(cntvct_el0 register) |\n            +------------------------+    +------------------------------+\n</code></pre><div class="line-numbers"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br><span class="line-number">21</span><br><span class="line-number">22</span><br><span class="line-number">23</span><br></div></div><h2 id="clocksource" tabindex="-1"><a class="header-anchor" href="#clocksource" aria-hidden="true">#</a> Clocksource</h2><p>The purpose of the clock source is to provide a timeline for the system that tells you where you are in time. For example issuing the command &#39;date&#39; on a Linux system will eventually read the clock source to determine exactly what time it is.</p><h2 id="clockevent" tabindex="-1"><a class="header-anchor" href="#clockevent" aria-hidden="true">#</a> Clockevent</h2><p>Clockevents take a desired time specification value and calculate the values to poke into hardware timer registers.</p><p>The hardware driving clock events has to be able to fire interrupts, so as to trigger events on the system timeline. On an SMP system, it is ideal (and customary) to have one such event driving timer per CPU core, so that each core can trigger events independently of any other core.</p>',7),r={render:function(e,n){return s}}}}]);