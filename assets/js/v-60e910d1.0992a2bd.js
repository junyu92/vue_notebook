"use strict";(self.webpackChunknotebook=self.webpackChunknotebook||[]).push([[9572],{3393:(n,s,a)=>{a.r(s),a.d(s,{data:()=>e});const e={key:"v-60e910d1",path:"/kernel/time/tick_broadcast.html",title:"Tick Broadcast",lang:"en-US",frontmatter:{},excerpt:"",headers:[{level:2,title:"Introduction",slug:"introduction",children:[]},{level:2,title:"Initialization",slug:"initialization",children:[]},{level:2,title:"Registering a timer as the tick_broadcast_device",slug:"registering-a-timer-as-the-tick-broadcast-device",children:[]},{level:2,title:"Tracking the CPUs in deep idle states",slug:"tracking-the-cpus-in-deep-idle-states",children:[]},{level:2,title:"Waking up the CPUs in depp idle states",slug:"waking-up-the-cpus-in-depp-idle-states",children:[]},{level:2,title:"Reference",slug:"reference",children:[]}],filePathRelative:"kernel/time/tick_broadcast.md",git:{updatedTime:1627629635e3,contributors:[{name:"Zhang Junyu",email:"zhangjunyu.92@bytedance.com",commits:1}]}}},31:(n,s,a)=>{a.r(s),a.d(s,{default:()=>_});var e=a(6252);const t=(0,e._)("h1",{id:"tick-broadcast",tabindex:"-1"},[(0,e._)("a",{class:"header-anchor",href:"#tick-broadcast","aria-hidden":"true"},"#"),(0,e.Uk)(" Tick Broadcast")],-1),p={class:"table-of-contents"},c=(0,e.Uk)("Introduction"),o=(0,e.Uk)("Initialization"),i=(0,e.Uk)("Registering a timer as the tick_broadcast_device"),r=(0,e.Uk)("Tracking the CPUs in deep idle states"),l=(0,e.Uk)("Waking up the CPUs in depp idle states"),u=(0,e.Uk)("Reference"),k=(0,e.uE)('<h2 id="introduction" tabindex="-1"><a class="header-anchor" href="#introduction" aria-hidden="true">#</a> Introduction</h2><p>Power management is an increasingly important responsibility of almost every subsystem in the Linux kernel. One of the most established power management mechanisms in the kernel is the cpuidle framework which puts idle CPUs into sleeping states until they have work to do. These sleeping states are called the &quot;C-states&quot; or CPU operating states. The deeper a C-state, the more power is conserved.</p><p>However, an interesting problem surfaces when CPUs enter certain deep C-states. Idle CPUs are typically woken up by their respective local timers when there is work to be done, <strong>but what happens if these CPUs</strong><strong>enter deep C-states in which these timers stop working?</strong> Who will wake up the CPUs in time to handle the work scheduled on them? This is where the &quot;tick broadcast framework&quot; steps in. <strong>It assigns a clock device that</strong><strong>is not affected by the C-states of the CPUs as the timer responsible for</strong><strong>handling the wakeup of all those CPUs that enter deep C-states.</strong></p><p>The tick broadcast framework in the kernel provides the necessary infrastructure to handle the wakeup of such CPUs at the right time.</p><h2 id="initialization" tabindex="-1"><a class="header-anchor" href="#initialization" aria-hidden="true">#</a> Initialization</h2><p>The very beginning function related to time initialization is <code>tick_init</code>.</p><div class="language-c ext-c line-numbers-mode"><pre class="language-c"><code><span class="token keyword">void</span> __init <span class="token function">tick_init</span><span class="token punctuation">(</span><span class="token keyword">void</span><span class="token punctuation">)</span>\n<span class="token punctuation">{</span>\n        <span class="token function">tick_broadcast_init</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>\n        <span class="token function">tick_nohz_init</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>\n<span class="token punctuation">}</span>\n</code></pre><div class="line-numbers"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br></div></div><p>The function contains two jobs:</p><ul><li><code>tick_broadcast_init</code></li><li><code>tick_nohz_init</code></li></ul><div class="language-c ext-c line-numbers-mode"><pre class="language-c"><code><span class="token keyword">void</span> __init <span class="token function">tick_broadcast_init</span><span class="token punctuation">(</span><span class="token keyword">void</span><span class="token punctuation">)</span>\n<span class="token punctuation">{</span>\n        <span class="token function">zalloc_cpumask_var</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>tick_broadcast_mask<span class="token punctuation">,</span> GFP_NOWAIT<span class="token punctuation">)</span><span class="token punctuation">;</span>\n        <span class="token function">zalloc_cpumask_var</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>tick_broadcast_on<span class="token punctuation">,</span> GFP_NOWAIT<span class="token punctuation">)</span><span class="token punctuation">;</span>\n        <span class="token function">zalloc_cpumask_var</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>tmpmask<span class="token punctuation">,</span> GFP_NOWAIT<span class="token punctuation">)</span><span class="token punctuation">;</span>\n<span class="token macro property"><span class="token directive-hash">#</span><span class="token directive keyword">ifdef</span> <span class="token expression">CONFIG_TICK_ONESHOT</span></span>\n        <span class="token function">zalloc_cpumask_var</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>tick_broadcast_oneshot_mask<span class="token punctuation">,</span> GFP_NOWAIT<span class="token punctuation">)</span><span class="token punctuation">;</span>\n        <span class="token function">zalloc_cpumask_var</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>tick_broadcast_pending_mask<span class="token punctuation">,</span> GFP_NOWAIT<span class="token punctuation">)</span><span class="token punctuation">;</span>\n        <span class="token function">zalloc_cpumask_var</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>tick_broadcast_force_mask<span class="token punctuation">,</span> GFP_NOWAIT<span class="token punctuation">)</span><span class="token punctuation">;</span>\n<span class="token macro property"><span class="token directive-hash">#</span><span class="token directive keyword">endif</span></span>\n<span class="token punctuation">}</span>\n</code></pre><div class="line-numbers"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br></div></div><p><code>tick_broadcast_init</code> allocates different cpumasks.</p><p>The first three cpumasks are:</p><ul><li><code>tick_broadcast_mask</code>, the bitmap which represents list of processors that are in a sleeping mode;</li><li><code>tick_broadcast_on</code> the bitmap that stores numbers of processors which are in a periodic broadcast state;</li><li><code>tmpmask</code> this bitmap for temporary usage.</li></ul><h2 id="registering-a-timer-as-the-tick-broadcast-device" tabindex="-1"><a class="header-anchor" href="#registering-a-timer-as-the-tick-broadcast-device" aria-hidden="true">#</a> Registering a timer as the <code>tick_broadcast_device</code></h2><p>During the initialization of the kernel, every timer in the system registers itself as a <code>tick_device</code>.</p><h2 id="tracking-the-cpus-in-deep-idle-states" tabindex="-1"><a class="header-anchor" href="#tracking-the-cpus-in-deep-idle-states" aria-hidden="true">#</a> Tracking the CPUs in deep idle states</h2><p>Now we&#39;ll return to the way the tick broadcast framework keeps track of when to wake up the CPUs that enter idle states when their local timers stop. Just before a CPU enters such an idle state, it calls into the tick broadcast framework. This CPU is then added to a list of CPUs to be woken up; specifically, a bit is set for this CPU in a &quot;broadcast mask&quot;.</p><div class="language-c ext-c line-numbers-mode"><pre class="language-c"><code><span class="token keyword">static</span> <span class="token keyword">inline</span> <span class="token keyword">void</span> <span class="token function">tick_broadcast_enable</span><span class="token punctuation">(</span><span class="token keyword">void</span><span class="token punctuation">)</span>\n<span class="token punctuation">{</span>\n        <span class="token function">tick_broadcast_control</span><span class="token punctuation">(</span>TICK_BROADCAST_ON<span class="token punctuation">)</span><span class="token punctuation">;</span>\n<span class="token punctuation">}</span>\n</code></pre><div class="line-numbers"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br></div></div><p>Then a check is made to see if the time at which this CPU has to be woken up is prior to the time at which the tick_broadcast_device has been currently programmed. If so, the time at which the tick_broadcast_device should interrupt is updated to reflect the new value and this value is programmed into the external timer. The tick_cpu_device of the CPU that is going to deep idle state is now put in CLOCK_EVT_MODE_SHUTDOWN mode, meaning that it is no longer functional.</p><p>Each time a CPU goes to deep idle state, the above steps are repeated and the tick_broadcast_device is programmed to fire at the earliest of the wakeup times of the CPUs in deep idle states.</p><h2 id="waking-up-the-cpus-in-depp-idle-states" tabindex="-1"><a class="header-anchor" href="#waking-up-the-cpus-in-depp-idle-states" aria-hidden="true">#</a> Waking up the CPUs in depp idle states</h2><p>When the external timer expires, it interrupts one of the online CPUs, which scans the list of CPUs that have asked to be woken up to check <strong>if any of their wakeup times have been reached</strong>.</p><p>IPIs are then sent to all the CPUs that are present in this mask. Since wakeup interrupts are sent to a group of CPUs, this framework is called the &quot;broadcast&quot; framework. The broadcast is done in <code>tick_do_broadcast()</code> in <code>kernel/time/tick-broadcast.c</code>.</p><div class="language-c ext-c line-numbers-mode"><pre class="language-c"><code><span class="token keyword">static</span> bool <span class="token function">tick_do_broadcast</span><span class="token punctuation">(</span><span class="token keyword">struct</span> <span class="token class-name">cpumask</span> <span class="token operator">*</span>mask<span class="token punctuation">)</span>\n<span class="token punctuation">{</span>\n        <span class="token keyword">int</span> cpu <span class="token operator">=</span> <span class="token function">smp_processor_id</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>\n        <span class="token keyword">struct</span> <span class="token class-name">tick_device</span> <span class="token operator">*</span>td<span class="token punctuation">;</span>\n        bool local <span class="token operator">=</span> false<span class="token punctuation">;</span>\n\n        <span class="token comment">/*\n         * Check, if the current cpu is in the mask\n         */</span>\n        <span class="token keyword">if</span> <span class="token punctuation">(</span><span class="token function">cpumask_test_cpu</span><span class="token punctuation">(</span>cpu<span class="token punctuation">,</span> mask<span class="token punctuation">)</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>\n                <span class="token keyword">struct</span> <span class="token class-name">clock_event_device</span> <span class="token operator">*</span>bc <span class="token operator">=</span> tick_broadcast_device<span class="token punctuation">.</span>evtdev<span class="token punctuation">;</span>\n\n                <span class="token function">cpumask_clear_cpu</span><span class="token punctuation">(</span>cpu<span class="token punctuation">,</span> mask<span class="token punctuation">)</span><span class="token punctuation">;</span>\n                <span class="token comment">/*\n                 * We only run the local handler, if the broadcast\n                 * device is not hrtimer based. Otherwise we run into\n                 * a hrtimer recursion.\n                 *\n                 * local timer_interrupt()\n                 *   local_handler()\n                 *     expire_hrtimers()\n                 *       bc_handler()\n                 *         local_handler()\n                 *           expire_hrtimers()\n                 */</span>\n                local <span class="token operator">=</span> <span class="token operator">!</span><span class="token punctuation">(</span>bc<span class="token operator">-&gt;</span>features <span class="token operator">&amp;</span> CLOCK_EVT_FEAT_HRTIMER<span class="token punctuation">)</span><span class="token punctuation">;</span>\n        <span class="token punctuation">}</span>\n\n        <span class="token keyword">if</span> <span class="token punctuation">(</span><span class="token operator">!</span><span class="token function">cpumask_empty</span><span class="token punctuation">(</span>mask<span class="token punctuation">)</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>\n                <span class="token comment">/*\n                 * It might be necessary to actually check whether the devices\n                 * have different broadcast functions. For now, just use the\n                 * one of the first device. This works as long as we have this\n                 * misfeature only on x86 (lapic)\n                 */</span>\n                td <span class="token operator">=</span> <span class="token operator">&amp;</span><span class="token function">per_cpu</span><span class="token punctuation">(</span>tick_cpu_device<span class="token punctuation">,</span> <span class="token function">cpumask_first</span><span class="token punctuation">(</span>mask<span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>\n                td<span class="token operator">-&gt;</span>evtdev<span class="token operator">-&gt;</span><span class="token function">broadcast</span><span class="token punctuation">(</span>mask<span class="token punctuation">)</span><span class="token punctuation">;</span>\n        <span class="token punctuation">}</span>\n        <span class="token keyword">return</span> local<span class="token punctuation">;</span>\n<span class="token punctuation">}</span>\n</code></pre><div class="line-numbers"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br><span class="line-number">21</span><br><span class="line-number">22</span><br><span class="line-number">23</span><br><span class="line-number">24</span><br><span class="line-number">25</span><br><span class="line-number">26</span><br><span class="line-number">27</span><br><span class="line-number">28</span><br><span class="line-number">29</span><br><span class="line-number">30</span><br><span class="line-number">31</span><br><span class="line-number">32</span><br><span class="line-number">33</span><br><span class="line-number">34</span><br><span class="line-number">35</span><br><span class="line-number">36</span><br><span class="line-number">37</span><br><span class="line-number">38</span><br><span class="line-number">39</span><br><span class="line-number">40</span><br></div></div><p>Every tick device has a &quot;broadcast method&quot; associated with it. This method is an architecture-specific function encapsulating the way inter-processor interrupts (IPIs) are sent to a group of CPUs. Similarly, each local timer is also associated with this method. The broadcast method of the local timer of one of the CPUs in the temporary mask is invoked by passing it the same mask.</p><p>On ARM64, the broadcast method is <code>tick_broadcast()</code> which was installed within <code>tick_setup_device()</code>.</p><div class="language-c ext-c line-numbers-mode"><pre class="language-c"><code><span class="token macro property"><span class="token directive-hash">#</span><span class="token directive keyword">ifdef</span> <span class="token expression">CONFIG_GENERIC_CLOCKEVENTS_BROADCAST</span></span>\n<span class="token keyword">void</span> <span class="token function">tick_broadcast</span><span class="token punctuation">(</span><span class="token keyword">const</span> <span class="token keyword">struct</span> <span class="token class-name">cpumask</span> <span class="token operator">*</span>mask<span class="token punctuation">)</span>\n<span class="token punctuation">{</span>\n        <span class="token function">smp_cross_call</span><span class="token punctuation">(</span>mask<span class="token punctuation">,</span> IPI_TIMER<span class="token punctuation">)</span><span class="token punctuation">;</span>\n<span class="token punctuation">}</span>\n<span class="token macro property"><span class="token directive-hash">#</span><span class="token directive keyword">endif</span></span>\n</code></pre><div class="line-numbers"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br></div></div><h2 id="reference" tabindex="-1"><a class="header-anchor" href="#reference" aria-hidden="true">#</a> Reference</h2>',28),d={href:"https://lwn.net/Articles/574962/",target:"_blank",rel:"noopener noreferrer"},h=(0,e.Uk)("The tick broadcast framework"),m={href:"http://www.wowotech.net/timer_subsystem/tick-broadcast-framework.html",target:"_blank",rel:"noopener noreferrer"},b=(0,e.Uk)("Linux时间子系统之（十四）：tick broadcast framework"),_={render:function(n,s){const a=(0,e.up)("RouterLink"),_=(0,e.up)("OutboundLink");return(0,e.wg)(),(0,e.iD)(e.HY,null,[t,(0,e._)("nav",p,[(0,e._)("ul",null,[(0,e._)("li",null,[(0,e.Wm)(a,{to:"#introduction"},{default:(0,e.w5)((()=>[c])),_:1})]),(0,e._)("li",null,[(0,e.Wm)(a,{to:"#initialization"},{default:(0,e.w5)((()=>[o])),_:1})]),(0,e._)("li",null,[(0,e.Wm)(a,{to:"#registering-a-timer-as-the-tick-broadcast-device"},{default:(0,e.w5)((()=>[i])),_:1})]),(0,e._)("li",null,[(0,e.Wm)(a,{to:"#tracking-the-cpus-in-deep-idle-states"},{default:(0,e.w5)((()=>[r])),_:1})]),(0,e._)("li",null,[(0,e.Wm)(a,{to:"#waking-up-the-cpus-in-depp-idle-states"},{default:(0,e.w5)((()=>[l])),_:1})]),(0,e._)("li",null,[(0,e.Wm)(a,{to:"#reference"},{default:(0,e.w5)((()=>[u])),_:1})])])]),k,(0,e._)("ul",null,[(0,e._)("li",null,[(0,e._)("a",d,[h,(0,e.Wm)(_)])]),(0,e._)("li",null,[(0,e._)("a",m,[b,(0,e.Wm)(_)])])])],64)}}}}]);