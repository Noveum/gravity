export const themeKey = "gravity-theme";
export const densityKey = "gravity-density";
export const sidebarKey = "gravity-sidebar";
export const darkQuery = "(prefers-color-scheme: dark)";

export const appearanceBootScript = `try{var s=localStorage,t=s.getItem("${themeKey}")||"system",d=t==="dark"||(t!=="light"&&matchMedia("${darkQuery}").matches),r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";r.dataset.density=s.getItem("${densityKey}")==="comfortable"?"comfortable":"compact";r.dataset.sidebar=s.getItem("${sidebarKey}")==="collapsed"?"collapsed":"expanded"}catch(e){}`;
