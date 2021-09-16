"use strict";(self.webpackChunknotebook=self.webpackChunknotebook||[]).push([[6721],{521:(e,a,n)=>{n.r(a),n.d(a,{data:()=>s});const s={key:"v-33640c77",path:"/kernel/trace/ftrace.html",title:"ftrace",lang:"en-US",frontmatter:{},excerpt:"",headers:[{level:2,title:"events",slug:"events",children:[]},{level:2,title:"function",slug:"function",children:[]}],filePathRelative:"kernel/trace/ftrace.md",git:{updatedTime:1627543229e3,contributors:[{name:"Zhang Junyu",email:"zhangjunyu.92@bytedance.com",commits:1}]}}},5617:(e,a,n)=>{n.r(a),n.d(a,{default:()=>l});const s=(0,n(6252).uE)('<h1 id="ftrace" tabindex="-1"><a class="header-anchor" href="#ftrace" aria-hidden="true">#</a> ftrace</h1><h2 id="events" tabindex="-1"><a class="header-anchor" href="#events" aria-hidden="true">#</a> events</h2><ol><li>list all avaiable events</li></ol><div class="language-bash ext-sh line-numbers-mode"><pre class="language-bash"><code><span class="token function">cat</span> available_events\n</code></pre><div class="line-numbers"><span class="line-number">1</span><br></div></div><ol start="2"><li>enable tracepoints</li></ol><div class="language-bash ext-sh line-numbers-mode"><pre class="language-bash"><code><span class="token builtin class-name">echo</span> <span class="token number">1</span> <span class="token operator">&gt;</span> ./events/kvm/kvm_entry/enable\n<span class="token builtin class-name">echo</span> <span class="token number">1</span> <span class="token operator">&gt;</span> ./events/kvm/kvm_exit/enable\n</code></pre><div class="line-numbers"><span class="line-number">1</span><br><span class="line-number">2</span><br></div></div><ol start="3"><li>enable tracing</li></ol><div class="language-bash ext-sh line-numbers-mode"><pre class="language-bash"><code><span class="token builtin class-name">echo</span> <span class="token number">1</span> <span class="token operator">&gt;</span> tracing_on\n</code></pre><div class="line-numbers"><span class="line-number">1</span><br></div></div><ol start="4"><li>display tracing information</li></ol><div class="language-bash ext-sh line-numbers-mode"><pre class="language-bash"><code>\n</code></pre><div class="line-numbers"><span class="line-number">1</span><br></div></div><h2 id="function" tabindex="-1"><a class="header-anchor" href="#function" aria-hidden="true">#</a> function</h2>',11),l={render:function(e,a){return s}}}}]);