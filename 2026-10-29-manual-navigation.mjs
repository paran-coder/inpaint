export function currentSection(tops,atBottom,readingLine=32){
  if(!tops.length)return -1;
  if(atBottom)return tops.length-1;
  let active=0;
  tops.forEach((top,index)=>{if(top<=readingLine)active=index;});
  return active;
}

if(typeof document!=='undefined'){
  const links=[...document.querySelectorAll('.manual-nav a[href^="#"]')];
  const sections=links.map(link=>document.getElementById(link.hash.slice(1)));
  let scheduled=false;
  function update(){
    scheduled=false;
    const root=document.documentElement;
    const atBottom=window.scrollY>0&&window.scrollY+window.innerHeight>=root.scrollHeight-2;
    const active=currentSection(sections.map(section=>section?.getBoundingClientRect().top??Infinity),atBottom);
    links.forEach((link,index)=>{
      link.classList.toggle('is-current',index===active);
      if(index===active)link.setAttribute('aria-current','location');
      else link.removeAttribute('aria-current');
    });
  }
  function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(update);}}
  window.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',schedule);
  window.addEventListener('hashchange',schedule);
  window.addEventListener('load',schedule);
  document.fonts?.ready.then(schedule);
  schedule();
}
