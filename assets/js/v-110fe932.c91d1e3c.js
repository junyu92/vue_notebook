"use strict";(self.webpackChunknotebook=self.webpackChunknotebook||[]).push([[3255],{5166:(s,n,a)=>{a.r(n),a.d(n,{data:()=>e});const e={key:"v-110fe932",path:"/kernel/task/thread_info.html",title:"Thread Info",lang:"en-US",frontmatter:{},excerpt:"",headers:[{level:2,title:"struct thread_info",slug:"struct-thread-info",children:[]},{level:2,title:"Memory position of thread_info",slug:"memory-position-of-thread-info",children:[{level:3,title:"If thread_info is stored within struct task_struct",slug:"if-thread-info-is-stored-within-struct-task-struct",children:[]}]}],filePathRelative:"kernel/task/thread_info.md",git:{updatedTime:1631761118e3,contributors:[{name:"Zhang Junyu",email:"junyu92@163.com",commits:1}]}}},4363:(s,n,a)=>{a.r(n),a.d(n,{default:()=>t});const e=(0,a(6252).uE)('<h1 id="thread-info" tabindex="-1"><a class="header-anchor" href="#thread-info" aria-hidden="true">#</a> Thread Info</h1><h2 id="struct-thread-info" tabindex="-1"><a class="header-anchor" href="#struct-thread-info" aria-hidden="true">#</a> struct thread_info</h2><div class="language-c ext-c line-numbers-mode"><pre class="language-c"><code><span class="token comment">/*\n * low level task data that entry.S needs immediate access to.\n */</span>\n<span class="token keyword">struct</span> <span class="token class-name">thread_info</span> <span class="token punctuation">{</span>\n        <span class="token keyword">unsigned</span> <span class="token keyword">long</span>           flags<span class="token punctuation">;</span>          <span class="token comment">/* low level flags */</span>\n<span class="token macro property"><span class="token directive-hash">#</span><span class="token directive keyword">ifdef</span> <span class="token expression">CONFIG_ARM64_SW_TTBR0_PAN</span></span>\n        u64                     ttbr0<span class="token punctuation">;</span>          <span class="token comment">/* saved TTBR0_EL1 */</span>\n<span class="token macro property"><span class="token directive-hash">#</span><span class="token directive keyword">endif</span></span>\n        <span class="token keyword">union</span> <span class="token punctuation">{</span>\n                u64             preempt_count<span class="token punctuation">;</span>  <span class="token comment">/* 0 =&gt; preemptible, &lt;0 =&gt; bug */</span>\n                <span class="token keyword">struct</span> <span class="token punctuation">{</span>\n<span class="token macro property"><span class="token directive-hash">#</span><span class="token directive keyword">ifdef</span> <span class="token expression">CONFIG_CPU_BIG_ENDIAN</span></span>\n                        u32     need_resched<span class="token punctuation">;</span>\n                        u32     count<span class="token punctuation">;</span>\n<span class="token macro property"><span class="token directive-hash">#</span><span class="token directive keyword">else</span></span>\n                        u32     count<span class="token punctuation">;</span>\n                        u32     need_resched<span class="token punctuation">;</span>\n<span class="token macro property"><span class="token directive-hash">#</span><span class="token directive keyword">endif</span></span>\n                <span class="token punctuation">}</span> preempt<span class="token punctuation">;</span>\n        <span class="token punctuation">}</span><span class="token punctuation">;</span>\n<span class="token macro property"><span class="token directive-hash">#</span><span class="token directive keyword">ifdef</span> <span class="token expression">CONFIG_SHADOW_CALL_STACK</span></span>\n        <span class="token keyword">void</span>                    <span class="token operator">*</span>scs_base<span class="token punctuation">;</span>\n        <span class="token keyword">void</span>                    <span class="token operator">*</span>scs_sp<span class="token punctuation">;</span>\n<span class="token macro property"><span class="token directive-hash">#</span><span class="token directive keyword">endif</span></span>\n<span class="token punctuation">}</span><span class="token punctuation">;</span>\n</code></pre><div class="line-numbers"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br><span class="line-number">11</span><br><span class="line-number">12</span><br><span class="line-number">13</span><br><span class="line-number">14</span><br><span class="line-number">15</span><br><span class="line-number">16</span><br><span class="line-number">17</span><br><span class="line-number">18</span><br><span class="line-number">19</span><br><span class="line-number">20</span><br><span class="line-number">21</span><br><span class="line-number">22</span><br><span class="line-number">23</span><br><span class="line-number">24</span><br><span class="line-number">25</span><br></div></div><h2 id="memory-position-of-thread-info" tabindex="-1"><a class="header-anchor" href="#memory-position-of-thread-info" aria-hidden="true">#</a> Memory position of thread_info</h2><p>thread_info is stored within either <code>struct task_struct</code> or stack.</p><h3 id="if-thread-info-is-stored-within-struct-task-struct" tabindex="-1"><a class="header-anchor" href="#if-thread-info-is-stored-within-struct-task-struct" aria-hidden="true">#</a> If thread_info is stored within <code>struct task_struct</code></h3><div class="language-c ext-c line-numbers-mode"><pre class="language-c"><code><span class="token keyword">struct</span> <span class="token class-name">task_struct</span> <span class="token punctuation">{</span>\n<span class="token macro property"><span class="token directive-hash">#</span><span class="token directive keyword">ifdef</span> <span class="token expression">CONFIG_THREAD_INFO_IN_TASK</span></span>\n        <span class="token comment">/*\n         * For reasons of header soup (see current_thread_info()), this\n         * must be the first element of task_struct.\n         */</span>\n        <span class="token keyword">struct</span> <span class="token class-name">thread_info</span>              thread_info<span class="token punctuation">;</span>\n<span class="token macro property"><span class="token directive-hash">#</span><span class="token directive keyword">endif</span></span>\n\t<span class="token comment">// ...</span>\n<span class="token punctuation">}</span>\n</code></pre><div class="line-numbers"><span class="line-number">1</span><br><span class="line-number">2</span><br><span class="line-number">3</span><br><span class="line-number">4</span><br><span class="line-number">5</span><br><span class="line-number">6</span><br><span class="line-number">7</span><br><span class="line-number">8</span><br><span class="line-number">9</span><br><span class="line-number">10</span><br></div></div>',7),t={render:function(s,n){return e}}}}]);