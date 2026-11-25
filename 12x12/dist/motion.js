const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const scenes = document.querySelectorAll('.orbital-stage, .referral-hero');
function resetParallax(hero) {
  hero.style.removeProperty('--mx');
  hero.style.removeProperty('--my');
}
function applyMotion() {
  root.classList.toggle('tab-inactive', document.hidden);
  if (reduced.matches || document.hidden) scenes.forEach(resetParallax);
}
scenes.forEach(hero => {
  hero.addEventListener('pointermove', event => {
    if (reduced.matches || !finePointer.matches) return;
    const box = hero.getBoundingClientRect();
    hero.style.setProperty('--mx', ((event.clientX - box.left) / box.width - .5) * 13 + 'px');
    hero.style.setProperty('--my', ((event.clientY - box.top) / box.height - .5) * 8 + 'px');
  });
  hero.addEventListener('pointerleave', () => resetParallax(hero));
});
reduced.addEventListener('change', applyMotion);
document.addEventListener('visibilitychange', applyMotion);
applyMotion();

if('IntersectionObserver' in window&&!reduced.matches){
 const observer=new IntersectionObserver(entries=>{
  for(const entry of entries){
   if(!entry.isIntersecting)continue;
   entry.target.classList.add('entered');
   observer.unobserve(entry.target);
  }
 },{threshold:.14});
 document.querySelectorAll('[data-reveal]').forEach(section=>observer.observe(section));
}
