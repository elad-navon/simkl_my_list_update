"use strict";

// The page's settings and plumbing: keys, local storage, the Settings
// screen.
//
// One of the page script's files (app/), loaded in order by index.html as
// plain scripts sharing one global scope - so code that runs while a file
// loads may use only what earlier files define.

// Text from outside (show and episode titles, cast, networks, image URLs,
// error messages) goes into the page's HTML through esc(), never as is:
// TMDB titles are open to anyone's edits, and a title with markup in it
// would otherwise run as part of the page. IMDb ids go into links and
// onclick strings, so only a real one ("tt" + digits) is used.
const esc = t => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isImdbId = id => /^tt\d+$/.test(String(id || ""));

// ---------------------------------------------------------------------
// Config - not hardcoded. Stored only in this browser's localStorage,
// so this HTML file itself never contains your keys (safe to commit).
// ---------------------------------------------------------------------
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342";
const TMDB_BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";
const TMDB_LOGO_BASE = "https://image.tmdb.org/t/p/w92";
const TMDB_PROFILE_BASE = "https://image.tmdb.org/t/p/w185";
// Manual fallback for networks that have no logo in TMDB (or aren't in TMDB
// at all) - mainly small/regional broadcasters,
// e.g. Israeli channels. `names` lists every name variant this network
// shows up under (different language/script, with or
// without a trailing channel number - see findLocalNetworkLogo). `logo` is
// a ready-to-use image src (a data URI), not a path - these aren't fetched
// from anywhere at runtime.
const LOCAL_NETWORK_LOGOS = [
  { names: ["רשת", "Reshet"], logo: "data:image/png;base64,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" },
  { names: ["כאן", "כאן 11", "Kan", "Kan 11"], logo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFEAAAAkCAYAAADxYNZEAAAKz0lEQVR4AexZB2yUyRV+b73rCr5QLAEBocCBIbTAJWeKuNCLUCihHqEjAaGdMUainEBCNFEEHEGCSAgEogkwRxPGGDggAg5z9GYTHA4MnLAowRivy+7kfWP/9u/d/1/DYTtHlNXOTnvz5s03r8zMOuh/4JOdnV3nv7mMCgXRnf3iTx+yuPycl53eZXxERMQTX7pMpar6tpnrSmVWVUXgg9btft3Y3P8+5QoDEUKFRlQ/9D7C+NI6Q4PT1M9cXBRzli8/c505KouLwAdtaGhkmrn/fcoVBqKvUDu2b1OxsbHq66/nq69i49TBQ0fUuwjKH7C4d+FfHjQVBqKvcAcOHKA1a9bQ0qWLad26dXTq1ClfklJ1BVN+W6qpuAJTLK6UUcgUsy2DRHe/D089wPRTaSCSI1imdVCViDByUAEFlTEzh1X7zjA3GVjqC1M0N8CnmesoP3/+agLyKDFb5GUlX55l0Zv7bZeSlfWy0+UrF9WJ09+pcymXA5qe+7W78ZUrP6gz/zitvk+5qGl9d5aZ9by5ubnk8Shi8up6drayjKynkxNVwu7tas+ePWr3vm/V3fuPlB5g8QOfhubs14WB7Nq1a6p9+5iNR48e1WMyMzMtg0x6errasWOH2rt3r9q/f7+eSyxGnT9/XqWmpuqx4FtWsgUx+cTxUzExn1PXTp0ofuZMPz7ZRZENHUcPHUlt3foz+uKLP1J83Aw0ke/O5rrfUnCwk/ILCgjSOV0hmi4igv0iKzr+OmUyDRz6Fxo2fCgNHTaYUr6/iOaAKSKy+qG7t++o7t27U+q9VOr/5wGUlHhcRUVFWQaZpKREGjN2PA0a/CUNGDCAhgwZTP3796d27dpRTEwMdezYUW3ZsgXiBpzXEsQ7d+6ouBlficbIWFEg9vrzMY4V6Tfvq1nx8UJI5AwJordvrR2ZyxVEeXl55HIVgoeyHmTzk+8hcjhJ6F1EBR5yOPwJcQIwt164cFF17dqVXrx4QUFBTsp1u6lnr+6UnHTcfwEyEC4lLzefglzBFBoaTiEhwXq+4OBgevXqFV24cIHGjBlDbdu2VVeuXLHkIWzEPeG3KCUkJKg58+aqjh070NOMp+SAxTFRnsddRFGSHUo8qKbHzVCf/SGGMp7+JAK4qCDXQyFh4SVE5pIjiEh4QXDJiNlWJsLH5Qwhh3KSt4DJ6XTRW9FktJuT+QRw7nyKGjV6ND15+oSChd6TL5TKQbVrR1FklVCp+H8dWgSmIJeT3AJ4rjtPbzQ2OCwsjPLz8zWoAHPIkCF05swZPYJ8Pg5zHYRLlywhMVVhQGJ+0u0VEEWDzHQPf7yvQPu3b74hJUjnS6BgDiKSKQrEXM20Rjk/T1RL/CL6JTOabXMvMSnFelEej4fCQoNtaX8Qnz1q1AhKS00VwB0iOxAk+rRRIxK/SJ+374h98xsfGfkrqlW3DtWtW5caNW5MzZs1p+joaKpatapYoUe030Fer1dwCKZ79+7RaNmkR48ePfFlJCiVNGGBhUDIEoKYcnK9hHpklSolRFIqkMAQHhJOyuOlf2e/khDhIWMsC5BC4vd1OWUquAUBW2eS+xGZGqCpBd58WYCTlLeARCVNvSXF2zdvqd59etG/0v8piyaCbPmeAmrY8Df07f591Op3v7cEEBwGfzmcf8r4kdNTb/G9tLt849ZNloDC6enp8Rs3bhQeDTWIHtlEZqaHDx/S9OnTa2OsOcnKSqpJSUl07NgxOnjwIEU3+S3wE8EclJvjLiGSUoMGn/KuHbspMTGRkk8cp8bRjaS1Yr9Wm4Mo3L1nD3r27Fmx5oSEhGjNSkjYS82bN7cFMJC0EohWjR07ls+dOxcv/lDzDg0N1Tk0+/jx0j62FIg9evTgnj17cu/evTkyMpKYWYOolL96SQTUtOLINa3WRKr4z+vXhXfc27dvq379+tHjx4+133I6nQQZqlevTkeOHKFWrVr9LADNKwCYW7du1ZuSk5ND8JNu8Z1QHjNdKRDNHcysQYRgDqvQaCIOChJ/KHUjl2KFfWVz065evaqj8IMHDySghWgNgZyNxAcePny4XAA0FiA8edCgQboKZQIWycnJum782IIIYgwCIcrI7RKiGQCE77CjKa/2kydPqj59+tDz58+1leDwDjkbS2BISEigNm3acHnNZfARC9VzQQu9EmjS0kq/VdiCiJ2FcPAFCPUGQ6sctMzlLrvVVHT9+nVtwpANC4IZIzVr1oxatGhRIUJUkcCKucLDw7V1+uJhC6KhfdhpMLBcUVEjJjHoi5oqLIuNjeVVq1bpYwzmxQZiUQiIw4YN83fe5SAJ/C7YGBeJTz75BMfA4uuqLYgul0urMHYc5yYwsUtgDpO26y/PdjnD1pk5cyavXr2a3rx5o1njhgEZ9u3bRyNHjix3IBGRmVn7X0wI12Hc2FB34McqYYcNDYQ2WtEYbaCDTzTqVjlo3kdbsSnYSIMXc6GlGsLPmDGDFy5caHQT5ofM27ZtIzmelBuQJ06cULt27SIoExImhE9GbiRbEEHAXCg4yoESfJIRVIyJfOkBIID0bbergxZminGgMfijbKT58+dr0wbgRj/81ubNm8tFIy9duqRwS4EczIW3JxxzBg4caIig84Ag2gGiR5p+oDEAEgtG2dRVXHxXXsYAw4UATAQ3aJnRZ85h2suWLdOuB9oIs4YM0Mjx48cH1Ei4BhyX8Lhw8+ZNhbPn3bt3lRxh1OTJk1WXLl0oIyNDayF4gr/4ZGratGkp7bIFEQMMYc1lo82cY6ewSCzY3G4uA0SAbG4LVIYLwbzgiaMFNMCKHkDMnj2bl8idH7SggzzY1E2bNpFoki2QAvTjDh066Kcvefai1q1bU8uWLalbt260YcMG/SIFPrgFQdvbyROZzBXtK4ctiFg0cynAfcda1rOysizbmVnvqGWnRSMAgYliAQATm2RBRoaPlMXxggULCDcL0GEsxuHGESjYyCbom87Lly8JGwewmFnfgjAn+KBdbma0c+fOpzjsg7852YIIIgBpzlG2SoiOaIem1axZE0W/hD6Dn1+nRYPBk5mLbyQWZKWaBEResWKFDjIAEBuAOaFhpQiLKsYcoEUTcyF4GAPwMB6aOHHiRNq+ffvOevXqFR9rQG8kWxAnTJggfyotpcWLFxPKxgD/nEj8ByFSLlq0iEaMGGFFol9DLDtsGuEHsQhoJEhwNkNul+QGo/9TmTVrFq9du1ZrF/zj+vXrKS4uztKkoLUACalatWr6CIM5RbtxcNfrljdEkhcdrlWr1nC7uW1BFBPgOXPm8Lx581hedy2FMJiOGjWKESnnzp3L48aNs6SFaRg7bowLlOMKd+PGDRKnT+LsSczJzxeZx9eoUePvRn3q1Km8cuVK7demTJliKQ9oZY3REkzo8uXLdPbsWUI5JSUFr0K/lnlZ/pVk8YO248EDyRZEdJZnAoDQKsOEsPuB+NevX5/lUMvR0dHcpEkTvBSVvrAGGix98fHxPGnSpIAAwL8Zc+DZrEGDBtxUIq9o4hNh8c7fSgPRkMi4ZcDvGG0fe15pIEILARyOIACNOaCSgOSjSZUGIqIzcwlwODZ8NCiVIWilgQgfaPhFlKGVZcj20XRXGoi9evWiadOm4bihU+fOnT8akMoStNJAxDFJnq9wPePly5dz3759S2y7LCl/4f2VBuIvHIcPEu//IH4QfIWD/wMAAP//MsWTUAAAAAZJREFUAwCwk56FJlXzZgAAAABJRU5ErkJggg==" },
  { names: ["HOT", "הוט"], logo: "data:image/png;base64,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" },
  // Cropped from a real Keshet 12 brand mark supplied by the user (12.jpg) - TMDB has no logo for this network either, same gap as the three above.
  { names: ["קשת", "קשת 12", "Keshet", "Keshet 12"], logo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFwAAAAyCAYAAADREbxyAAAQAElEQVR4AeR7CZidRZX2e+q7a/ft2+ktvXc2tkAwaGRfHsBxQB0Q/B1wGUURUWFEBvGP/I8KiDyDjMsjm4M6OogssihD2APIz5pAIBvZt04n6XTS6fR6+67fV/Oeun073dlxgHmemUqd76vlVNU5b506VfXdjrHvcgiCwAZBYH3ft4VCwebzeZvJZGw6nbbDw8M2lUo50rSWZbNZx6P8QRC4tvZ/cDB4F0MQBCBwIMggyCCoIMDI5XLQOhGB53mONK88AwMDjk/TnCAQa/x3BB3XWt/JGfDdlxvEwt41eLTzFfyu/Qn8av2j+H3705jT0YEtqbTjszZAYO07Ete8I+4xzJYDlagEMq3VAa1vEUEsFkMymUQikUA8Hnf5aDSKSCSCsrIyVFZWOtIJGhoacsDr5Gh/2veY4d71pPa/iwLYwjYEqXmw3f8Mu+503LDwClyz4k7cseER/LHzBfxp64u4t/NZXP3WYpz42BL842trsXjnIPwRHA5WwP8S4AqMAkTX4IA2xjhQSwCHQiGIyCiVhBLZVaY8VVVVblLU2ksrQvtWQEpt3ou3pYX6PUvhr7kCdsPZkI6/g+m+ESazAB+JLIURjqqkL5UZFiEvDysGczb34aIX1+C25ZuR8X1yHFx8R4DbkdnUpa9AqyWrdarFKsj6VgBFilKKFN/7E0VEoBOlK6CmpgZq6Urav7odHRPvUtC+gsCHn9kBf/Mz8F/8GvD8ZyGLngH622GCLI3DkoDjvY1I2mE3MkXkW3URhCQH+j3yCHrzFrcs78Id89dhOJtjsSXf/uNBA67Kq9UpyGrRmlf3UF5e7lyEiDgh9j/cvmtFxLmduro69Pf3o2TpOs6+Wx1cjQOa1hwU0vBX/Bb2hS8B86+GbH8ZAp/kwXZVETAhaZ+CapPC30RWsk7zJCmSmDwTuyIxxx3PrcUvHl+KfMGHRbCrci+p/QKugiqpRaslK9iaVmtUHzzWmvfS9zsuEimCXltbC3UvuunquAq6yvFOOrRUXdsoBake5Bfcg8yPjob/wHcI7gpIkIdRODmme6WjCLZOACxBR9FSL4gtQhnGWq7AmAJri/Vg0HmwgcU9L2/AU4s3gfMKHZNVe41mr6Us1EaqqCpcOkGoy1CL1pMGWd6TKCJuow2Hw87SS2O/08Ho/RD4OWRfvwu5289CcN/X4fV1AH0p+Ms6EWwfKgI3ih2h60vAH4wT9OJoCaRxhNc1mtdSIwWdH02OkvUDZHMBrntgERa2d7N831a+B+AloH1uBOpHlRRotWgFQUQgIuz0vYsigubmZne8HBwcdMdKlUdlO5hR/byP9NLFGL7zC7D3fh3SuYQWnXNyCwRc+yis3Qa/sx+8MDiLZCkgBrKzghPlQVig9KHwJqZHZwVGfIwLrDIsEhEMpvO4+c9L0DecG8cyNmPGZjStSqnbUMsSKS7xEtBa/36QiEA30oaGBufL1Z/rSlPZsI/gljKXdmE4jc3fuxkbP3U5On+6EH0rK2ADj1ZKBLUtXwL9BwQbuHlu7AW4HHgwZCkZUjGgL05PTCSZbZVeeMwx6aKIWq+4tHsEzNN3a1rYw5KOPjwyvx0Bz/Lq1rR8LI0CbnVQNlaw1arVP+umqO5DRMa2eV/SIoKKigroZKuV6/6xLytX2a1YZLduR/sXrsTAnfcg2DmAXG8UO16vx/qHJmFoYwX8PP0z9VQghOCIML+1H/mNfeCBmsBTNSFtq+Yq0EkC2kK9iKDAwmLUaqVijs9CAKFLYcrFgm/x88eWYQ1XD32WKxv7GAd4CWx1IQq2SLHrsQ3ez7SIoLW1FQr4/qycho38wCA2fvZyZJ5/FShpJSqtIMiE0fVyAzqfbUa2P1oEVqtKtKUXQWcf8SlatRZb+nNwUmokhSopHg/BwPnic1cUui83WaUiypzOB/jZnKXIal2pfOTtRFML0Q1SLVtEnFWJOGlH2ICeHf146unFjh5/7m38x+vtpA14ZMFGPNaxA5uHhhHwjKsNNg2l8acN2zFnUzue2/YWVux4DkHvffC7/wh/46OOChvmILf8SRQ2LYKf7h9tq+1LJFKUpbGx0YGubk6NQuUt8ejb5rLYfPn3kVu6ChoEoi8+BeyCJIBvkN5ehi1PNyO1OUE/7VhYB7AWweZe2IEMNIiW0LXoOB6tu8nr12JHlnW6mlyGD8n5tHDLVDGKvnjSWfj2VqxcvZXealedVo0Cror43Cj1yCfimmn9KG3s2InrbvgPR9df/whm/+YVXP37N/DtP7yBy15Yg8+8sAodqazjX9QzhG9xQq57+y/4l7X3c+e+DtjyZWDZt2Dnz4Z97TvI3/sl+L86H/k7/ha5O87mse1eglDYQ0ARGb3+Dw8Pu41UjUMHUkACOu/04pVIP8cztYqtpJW7kysXTm4YnS80o295NcdC0aq1LgAKK7pgs5RBS9MRIB9yvUw2Pe6tj8CyjIBaZgL6dhmgzmPMXsu1V3/dZjz84DyOwY7JW4pGhVag1brVjehmVarc863zY3gjsyjv2Mp+LWeXHQ5msDGVwxvdg8UmBMkyFY/shNC3Hh3awhzb9pVDqEzQl4bZMcQ0rSPNTWvjm8jcehm233wDl3+OQpJ9TNRvMmN9uQKuciuLpT/puOJa2AwVx/4DxYLofZ0i73izFj1LamHzhuOptBaWm5+/pZ8SCnVk+VCcMlpMMrR+jkNG+EEYLrCJ7p/ezjREdMZcqcMk1t2L8OAwnvvLSqzhaagkq3IQBUABVwvXjVIL90rcUEVdhutbEEplEOknwBzY01lmI/2Qw5eLhje4eKQXCZvBYaEdwHAUyHmU2cLv6IFlf8poA4PBdZXYMrcF3bc8hqHXF1JhIqKVY2jKlCnOraTTaWflJSVSC5bwW8jaIidBsUq0OK3fK7G+qIJF71u12LmMlk6nXxxREOwYhFp5wD6CvjKAJ5x6MwxhHqSCH+NYVJrWbYZyEHcE1HyRPE58bDv1BfviWPff/5rDl41cNGotpSOXnkhc6V4eHnffCvppky8uORUg3rUTplCA6UmBKI1r5XlpeCaPabw4hJFH0J1kvaFCKUgqzzSb+IKBNUlse6UeftYDKOym797ECgeJ49GHiLh9Re8Cpc1T5da63rsfJhjkp74Kkm8DFHhqyO+FCkFACw2gk0J7oHcuoHvRBPRtLEOeE1+wBoWc5WlnCFSLl6AI34IY6NvpbgOfddkIAczDLxDsjTtgC5ouUsDP0LEtXTDqligHFcGipVuwvbTyKbBRKyiw9/1aNxk1hrnrVg4Moyyty9cilMkg0d4Jj+7Ea+9VliJR+bCX0TnGybw4gMBKmpYRAEF7D3ks64ChTeXY/vpEaEZE9AW7tp0Wpv1jXBARlM7lo5snXUCwfSegPpUK+rTAvOchE40gHQljeCyFPd4brV7UkYWlCVgUDHnDEXTMb8XQQBlyBDRDWVOdwxjKeRj2Q0inQyhkAggnwmR9urwwLDfp8GAasb4hhGxulCq6uhAd6EUQ5ABOkGK7vbsPK1d1juriLPxgAK+sLsPJH5+BU88+ClNrY5jAwcK5AmL0VeWbtyHCA78MFYFqjYfx6ZZafLTmw5hVdxr8yi8jaPs/8Fs+Bf+YzwPTz+ahoRw9C+sAWpaIQINOg9AyC70Dmh1HIuK+oasSCnieK60wlEK+p8/xWT7zBLvlth/h+K63cNK2RTh5lBbipO2LcMyqF1B11SXw2xoJfoD4P3ySvAtx3OZFqLp+LoZ5Ti+0zkLtTZtRfdESVP7DYmTLjkdT/aWY85Gf4jHSvWeeiDK61mc/cwLevuXzWP7LL2EZSd9vPvJt/P/nr8e3r/oY2iZXciX5KPCI+NzTS5kOOM0W4wAXKSpO2feIkw5pxDU/uQjf/ckXMfPEw+ARmORQBsn+FKq2dCO5tgNh+j9tOLMuiRs/fCz+6fAL0Nj6Y4Qm3YbQsTcifPKNKPvcrxG+5GEMNVyKfD9PAtpgd+J39d2LNB/jDxoKeOm0UhgYgr+TK0ssleHc8elS3Jl0c9xFBsI+4/UTMe3aqzD9oV/DTmlF11MvEAgf4EYaqT8UwyaKQqQS8MIQ8SC8Y6ZTvTCxw8liHKWydB+9gzA8DnoiLBPo2yM3R0E0EsKFf38Sbrrxc6hvSCCUz2PZs0vQ3zsEigejCgT0bfs/nQAi4gguFNPUk8BbxPgNoXbrTsQGUsXaEV6REb493h6Gu8pATwBxLYoPAeEKeQhXUeli0biniLgjom6cuVwGBfpMn36fzZwyqgu4mWmePekLWha4a3bg+hKOmDh0MmouOIcybEMhnYGIwItVIIjXIohUAGJQDBaZzABMtMXxiAhS6Ry8tT0Quh9LF2aJHX0Ix6EF062BowoMpk6tx2mzJqF8cAi5oSzeemUVNLietaGCrgUHSxyLXQOFkGAwGUd/shz5kLff5jqOpfJBfyeyLz4P2Y3bskRoeYjsu5+2tjb3U1yGH/wLXNogCNqPiMCjUB23/g5Lf/EbJ5sq3/nSPLz6qUvx+ldnI6urgTUCwYTjjuFmC6S3ceOzYGBp0wzYOCebfbEAZIP1MzR4uj4UQ6p7CDZr8b075+KbV/4a37ziX/GPV9xJ+iUu++Yv8cqryzmCTq7gmBmTIDohtMw3X1rNSbFFC1cg1I/ru9jtgZ8K9FAiir7KcuTCIeQr4igkE/ttqHoF+SwKT1yLqFk7jteN7Rk0Xfst6inj6koZEXGnFT1V5bhhB+QP8QcQredSRYgDFJatwfDbRWvS8lxXN4affRkDf3wUr557McCjGgdAxRGHEBgay4o1ZGNDPss/8FFIshkyYuE2SEEl8cJJ1nLNcEJ7ugcQ29GHVU8twvx56zGPF7w35m/AgtfasZigzn92MXmLsaGlhmOwHbMd67chzYuhERGIiPsEyvKDitloGAMEN8vTACDIVVWgf1orAgKP/QTL79OZuy6GfeMeVB81CEqjcbRF/ENHo/ykY8eVjVaOSehvoFm6E8sfow3dj8Il9NG6XD3Ko+8Su6Yj1C9Gn1zYtBUBV4WIIMT9wPNCSK1e5+RQ/omnfA4T/+ZrkBHAU90vQkIxGC8+wmPRu6wdyU3bMWt6I079QBtOO7oFjRLCBLqaBI+D5cQG6ivZocrFFyMntm8Yg/3DMCICQ2Gz2SwONhQ8A8s2yp9PxJFqbWBeIFqwDwro3/xld8GsfJR8FpHKDCqmDlIRWgD3LUlWoPYHVyDCt5BjH91ARKC/COnN2FcXliwj61jVxrcWVnnGcGODczlkdlH49MoKQJ5HNgkAFkTKqxCrqodlppDtx87VNyBW3gorPAqCwQIdm3oQyuXxg2svwM9+dRl+fPs30No2AZxJcAFgymEtYHNo2NHVyyQ7ZibF7zQOcENhlN4J4NQZ4OC5RBmGprTAesZ17NwCO989BpQk6HoJZu2dsDHjqi1b1BzTTUuj0gSt+fYbkTzpw2AxXP/Yd9DTigKutBzH1wAAD29JREFUPrwQjzlZdGzCBj2Lg+dvlU970HJ9A0XFMRIkEqDx1C6UTVjvSlytZVd0OYXBTnQ++3UUhpYhWnkyDTLseLT/dbTU4XiUx1rqoY1Ilsake2CsPIRjTzsScApYLFu4gUmBAMjR+gfZlq2AUCjEG1UBPg/rrDtwVMFCBummOgc22GVggGAClx52BeLMWacFpxYCr18GKaQQmlzrGISIhCvyaD1/GyZedyUqP3Y6FTMQUfEcyz4flh2rH1d5Ix+YDnAJ84wAPxwC2hrReOapwEg3BZ4ShPzG+AhX+qViiLEIJwPkOrnJsT1csFj32NVY828fRSHTjmjtuag+9Gq2May1WLipGx0R6uhpnkUj0cIiGvdw1Q2fR1VNEjpe385BLJm/huMUeX1+Nx/sT6mOXG68MIiI+0Yx0sf+X2KQmtKEQhmti+IoAH5rJa2XCo9raTmJdBudlwITullj4VXEgGSMIlJME0H0K7ej7ssXQMwIQuQ6UHTj0TgU8KqPn4FABAFB81qbcPRDd6L5/LMpVbEXb3gDGk/dzknoQv0p20E0UAo6ZL67HTaXHikSNJ9yBdr+/m60nPUwWo69G55XzjpBmrfaHy1ch1yyAunaKpYxWhKj5dgnnnk0Tv7oBzmuUDfgtecWo7N9B43BsMywzO7aNNXCRcRZOdsfMObrq5EpV99JkBht1ENAwMc21NPQcJ5f3jacx0vCcpjKNCytCgYwDUk+PMhZs+F9kGAL0xx/bPv9pUUEuoQV+EhrM6KtBURaBpA4JI3ytkaYEQssEMhYaCGSkwYQn5iFFymA2kOD8BGi7w5x1eUHtzEnEBHEq3h2bv4gwolmgHLRLJDxc7ht4Vos6B2G5RE4U1+FQPcPMAgwXBbG66+uwqJ5K7miA2xavxX/9lN+9/fh+iTa0GAtYEQEnuc5t6JXZhwoCJCjC+KLnRWZ/ZoyZ2XFHGADikllHtj8LAazy1jMkTwfUp5hGjA15TDn34DwR2ZDjILtiqEAqr+39InFkr0/rUpequI4DV9tRdMZ2zFhRj87DxBQw4B97Jx7K+yquQhxn/LIRy9I4RjZnhIizPJ4XTnyfcu0RdH/s07Yt7C9z28icza8hNlv3IY7VrbD9yIEvAyquGVbjISA+G3jXP7z7D9gzv0v4aar70KqPw8BdQMtTIRpIF4WgQPcsLFauV6ZxymDfQRhOTtxvEwHlbGxKxV5Xm4e2/IaHuyah0X5BmWGUGFbwaVLflROgdc8Cf6KP/OHh3uQW/AHR/q3IwWmLc/qbLTPqNYtIuxTCJQgdupXQRUgg1vQc/fX0HX7p7HlO5PhP/59RIMsPAHBBWK05h2/uxjbfvNF9D10JRJtCSQOr0NhyR3Y+fw/oefpy9A17xx0zpuFLa+04ZpnP4NbVz+M5elOXuqiEH4As/EwdDAZK50Y+DyiducFd/BHmg2rtsHQkIwYx6W8HttWVlfAlRhKG2EDtXBVxnEd5CMIG9iqsnHcf97Yjds2zKWlCeZkP8A6WjgHNw5wn8C0Q968FjL/Gtj7voLg7ouL9IeL4d/zVQS5IbbZe9RJ3rp1q1uVKrch8N7Ew2DCYURy/QgtfhiRFY8hkdmGct6CIx4QEu4dRhCTLEILH0S080nEC6+hbFIlYmGWp9cjspll+BMS3l+QDK1GNupjXbQRXlkINlQO4XcWIx5smB3qe4x4Av3nIR+LI1vGTRUh1pLPlQu4dFHGS2JV3RjA1cJFBIODg6wnQGxy4CgI+BVRTYjdjrI/t3UQ/elGl1/n16DbVrg+JeQDdQOuXB+mMgI5vAFCJfR3Qu1DCRQUewkKttL69esRjUYRJsgel7MkG+DVHUrXAUSpa8wDoh5o1QRaLK2KxHykMorymQ1IHFaDSEWUblTAuw/CIYN4bRrxxiHoOaAsYrHCNCMdjsF4HrJ+EiLsGJSOBib03wu5Ib66aisWLGrnJ9w8RAwIHzKxGPxQyK14Do1SqK2vRLUCLiJQS1HAVYne3l4cdOD4fktyr+x9wy0Ad+8cwpifb4NAJxGQalpvWQZgCQiFVxWHOaIeEgm7ScEBwrp16+ARBD2LK+Aqu5TXQNTK2Za4goZNG7BuBGEZuALD0xsQOaoRbjxP4BmAqpOYiGdgmnrheToxbMdOXigcTom5egEMZ2v4dD2BTDBeBLP//TVc9PO5uPz7D/EyxE/Exc5gjWAoEUPAMSxbaVRjOu6M6UjwvsHRwEEFqoQCrhcgPePiQIGbSxALwScJZA/udK6Km1AEWrWoMJm/rniahJEAqOYqAt8AywSGO39oJm90E8oBFRx7BrVslW3FihVIjPy9eSQScXLDUI0jPz7aSBW10TCEk+nNbEaYQBveEQwt2bB/EcrLCNAMoll4k7uhq0+Lte3bfhNW+jQCMLBwOFsNESkSrRvGA3ikBYHPVVcz7UGMoPgPCFg/VB6FFfZPnBpaa3D+F0+j7gJKCoiIE1wBNxReP39iv0H3eHacjEIHUSEDpqAJttOXtSF+ypzIHLA434R+W+6qtU4S3DwrhkGTdvVaIVyqken18A4dUbRYM+751ltvocBfpyorK1HOj1YKuIhQCUF01gXwIwmArsI7vB6hGY0IH9kIkyjKKCIYF6zAhnMwrd3gN2aUqjOI4I70qSiI59gt+bI++2VORAAxADESkiGwQVkZ4NGFgOUYCSLIh8LI01UmaEyX/+B8lNO6tXaUy7CDMH2iKtHX10csFBplGU/C7KdPnIqffelY/PzTx+DWE6bglhMm8z0ZJ0ysZC1wyWH1uPX4KfjekZ/A7EM+h8sP/TLSTXfDtvy7I7T9Fub4nwAn3Ax7/M3uDX2f9BOYT9wKifObtOup+FCQFy9eDPXd1bSoCRMmoIyKhugrVW4RgYSjiFz4/xA6uhlebQJeLEIQWc46SLGf0tNSNUu35k3dBokUWE3wWRYQ3Bdyh2CTXw0RNiIV/Bj8IFpqChgppllnSX40zB8twizT8iLpkx0gqC7Hhd84AzNPOJRZlpJ/HOCqQDwex8DAAHT5spc9oohg5uQ6nPvhKThvehPOn1Q3SpM5m9rg+LpKnE+ejzdPwxkTP+ioteYsmAkXjtBnYKovhDfpXNI5e5DxigqqG1FasGABli9fjokTJ0I/XKmFx7g5eZ6nw42QcHV8EohWgfCBD4wLRFn7clSRgmkeY9nEQnl13T6eOxr+mMbZAq078LTakYzUCXNKeh4PyuO6SFnCyHE0U14ewVXf+QTO/cJpGCvnKOBkdRXqVlSZjo4Od5vT8vebHCgUXH+hf+aZZ7B69WoHdENDA9TC1bp1JZasW+VT5SXBzbnx9D1Wp+tPmZSqBuC1dMNE6ARpPCCACrSFwb2Z47A+qINwtSto7Ai5QgJWdgGuvNgtZCs5KVZruEzYX0vLBPzge+fiY2fPRGicUQB7AK6KqELqx/W/fuzW9/uSVYDWrFmDxx9/HHpq0j9dVrDVupPJJNQoDEERkTHyCEQ3ssMvAiSE3YOVAGjq4WeFfvLtVkucFhea8GB2Fph0lSX4soUKxd2VuUfAflxi18OnhQceoWTjs84+Er/42Wdx2ilHwIjsYhpJkauYEhGICM+mIfdfPxT0rq4uvNOLEP7KoCDrWDt37sQrr7ziSCdfwW5qaoK6kxLYukSNGRW9OKLwRflN8jD4R1xCkNSxEDZanoTzkNYddGdDgFHAhMzFGLA+Dw8PEOw8xvZJHisYztSCqSKzPrU522iySILACKbyPnHjD8/D96/5JJoaqyDCVkpFptHn2BEck/pxdSl69NKr/qZNmyg8p260ybufULD1KPrSSy/hiSeewJYtW6Ag61/O6nusZat8e4A9IhJVBJWAd8RXENTOKp6CKlPA5O08raRZJdB/GA2ql+BfeSpZ7DcDBE5EXK3Q1q0N06VUQKRYphWiFs5mKrNSXTKM6y74EG696UKcefpRUGOAjINVm43SHjUigjBPK2rhujmplXd3d7+roKugSvp5taenB2+++Sbuvfde6OTqCUSBVtK/mq2pqUFFRQXU2hVskV3Kj2oxJiEikHACMnM2gkaCRTciYZ5EWD6GTeGkToK5uel4Ij8DY/208lmIuy0HCMGygGuF/Ez5FiEBDmlI4MpPTMej1/wtPnvKNNRVc8zdVx3b7R73AFwZdJbUylVRBV1vd52dncUBleGvJAVZSYFWH/3UU0/hySefHN0UJ02aBCV1I+pCFHydeAVbZRKhpgcxthAsU30kZNZvYKNHEDDZsxXdRTs/O/w+ezzr9lLPor7UJK4SJoiz5UVNwTprag1u+8oJuOubp+MbZ81ATSIOEfKwl4OJ2sc4PhGBLlm1JlW2qqrKWZieFPRopkdGBUyBU8JegpaXSHn1+4yuEj1Hz507F/fddx9effVVqMtSdzF58mS0tbVBrbqhoQElq9ZJD3O1qTwiB6+UiBAEAy/OD2eT/oQgcQ79bC3UXxcpcDfJ/5s6Dz28kJHdaWE5NSW5eYVGmdThsGQMZ9SX419mTcb8c2bizo8ciTNnNKOO5UL0RHQsce0P5sEme2dTJdWy9EanANTX10M3tHnz5uHFF1/EokWLoEdHvSTpiUa/NOqpRoFdu5Yf63l2fv755zFnzhznl/V4N3/+fCiPgqx/DaukFt3S0oKx7kPvAjq2yrB36Q5cWoRA6F54VGz7PezkJ2CbbkFQeQF6w8fgtvTHkCbYIWsQRRgTQ5U4OjENfzfxRHx90rn44fQv4L7TZ+CPZxyB3552OC6cUo/6eAQqk3EgGwj/HViS8RxmfHZXTkTcBqBWluRRTEEqbWBg2Lx5MxRAPbo9+OCDuP/++/HQQw85cLVcQdcjnYhA3ZK2VYCVJtF1tNGi1XXoROrZWscoAa2rS4TqjBCH+6uiiDiAPBOltc/gh6tLeAb/HaoOfRk/P/YWPHjC9aQf4oHjr8dvZ30XPz7qUlw+7VM4r/lUHFdzKA7n+bqWN9aQ8dhPUR78F4PZX3sRcaBHo1EoIGrpjY2NbvkrcNOmTcPUqVOh7xIdcsgho3mtUz51GQqyugwFvnSmVh+t+0QJaI+XBLUgvFdBtGOBiIew8RD3Io7CzBsxECMAI97DYA7Ut4jAIxC6xNW9KEh1dXVQ0NRCFUQlBVStVtNK6ia0XgFWK9Y2asnaXkHW/UEnUq1Z+xcRiAje2yBuDJHiGxCAJCIQIUEJ72k4IOA6uggFISk4CpICr25CN1S1enU3pXcprXUKrvKVAI7x+4dOnPajlqwkIjrE/xr6TwAAAP//2U8XvAAAAAZJREFUAwAlz6qG606XaQAAAABJRU5ErkJggg==" },
];

// ---------------------------------------------------------------------
// Nav bar icon - only this one needs to be rebuilt dynamically (its
// label text changes); the others are embedded directly in the static
// HTML above since they never change.
// ---------------------------------------------------------------------
// Poster (vertical) and banner (landscape) icons for the image-mode
// toggle - the icon shown reflects what you'll switch TO, matching
// the button's own label.
const ICON_POSTER_SHAPE = `<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"></rect></svg>`;
const ICON_BANNER_SHAPE = `<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"></rect></svg>`;
// The "simkl_" prefix on several keys below is historical; they're kept so
// existing settings and preferences carry over.
// SIMKL app ids, kept with the account keys: the computer's Emby bridge signs
// in to SIMKL with them for exact air times (tools/emby-bridge). The old V1
// id is no longer shown in Settings but stays with the account.
const LS_CLIENT_ID = "simkl_client_id";
const LS_TMDB_KEY = "tmdb_api_key";
const LS_CLIENT_ID_V2 = "simkl_client_id_v2";
const LS_MDBLIST_KEY = "mdblist_api_key"; // optional: Rotten Tomatoes + Trakt ratings
const LS_FANART_KEY = "fanart_api_key";   // optional: extra posters/banners in the image picker
const LS_TVDB_KEY = "tvdb_api_key";       // optional: TheTVDB posters/backgrounds in the image picker
const LS_TVDB_TOKEN = "tvdb_token";       // {key, token, at}: TheTVDB's month-long read token for that key
const LS_IMAGE_MODE = "simkl_image_mode"; // "poster" | "banner"
const LS_THEME = "simkl_theme"; // "light" | "dark"
const LS_PANEL_LAYOUT = "simkl_panel_layout"; // "paged" (one-page, default) | "scroll" (older vertically scrolling panels)
const LS_PANEL_IMAGES = "panel_image_mode"; // "banner" (default) | "poster" - the three bottom panels' thumbnails
const LS_LOADER_POSTERS = "loader_posters"; // the posters the loading screen rolls past (the last ones shown)
const LS_VIEW_MODE = "simkl_view_mode";   // "list" or "airing" (not restored on load - always starts on "list")


// A plain localStorage.setItem() throws QuotaExceededError once the
// origin's whole quota is full - which used to be able to abort renderRows
// itself (it persists the current view mode partway through), and
// separately made cycling a poster/banner silently stop doing anything
// visible (see saveImageOverride). None of these are anything more than
// a remembered preference/snapshot - losing one write is harmless, so it
// should never be allowed to break whatever the caller was actually doing.
function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    // Full or unavailable: this one write is lost, nothing else.
  }
}

const app = document.getElementById("app");
const subtitle = document.getElementById("subtitle");

// The loading screen: the posters last shown here rolling past on a strip
// of film, the progress line (the subtitle's text) under it. Plain frames
// until a first load has kept any posters; at least 10 frames, so one round
// of the strip is always wider than the screen.
function filmLoaderHtml() {
  let urls = [];
  try { urls = JSON.parse(localStorage.getItem(LS_LOADER_POSTERS) || "[]"); } catch (e) { urls = []; }
  if (!Array.isArray(urls)) urls = [];
  const frames = urls.length ? urls.slice(0, 12) : [""];
  while (frames.length < 10) frames.push(...frames.slice(0, 10 - frames.length));
  const round = frames.map(u => `<div class="film-frame">${u ? `<img src="${u}" alt="" onerror="this.remove()">` : ""}</div>`).join("");
  return `
    <div class="film-loader" role="status">
      <div class="film-strip"><div class="film-track" style="--frames:${frames.length}">${round}${round}</div></div>
      <div class="film-status" id="loaderStatus">${subtitle.textContent}</div>
    </div>`;
}

// The loading screen appears only once a load has taken LOADER_DELAY_MS:
// a quick load goes straight to the page, fading in, with no flash of
// film. Shown, it ends by easing to a stop and fading out (LOADER_EXIT_MS)
// before the page fades in.
const LOADER_DELAY_MS = 800;
const LOADER_EXIT_MS = 400;
let loaderTimer = null;
function showLoaderSoon() {
  if (!app.querySelector(".film-loader")) app.innerHTML = filmLoaderHtml();
  const el = app.querySelector(".film-loader");
  if (el.classList.contains("shown")) return;
  clearTimeout(loaderTimer);
  loaderTimer = setTimeout(() => el.classList.add("shown"), LOADER_DELAY_MS);
}
async function finishLoader() {
  clearTimeout(loaderTimer);
  const el = app.querySelector(".film-loader.shown");
  if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // The film keeps rolling a little further, slowing to a stop.
  const track = el.querySelector(".film-track");
  if (track) {
    const m = new DOMMatrix(getComputedStyle(track).transform);
    track.style.animation = "none";
    track.style.transform = `translateX(${m.m41}px)`;
    void track.offsetWidth;
    track.style.transition = `transform ${LOADER_EXIT_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1)`;
    track.style.transform = `translateX(${m.m41 - 90}px)`;
  }
  el.classList.add("leaving");
  await new Promise(r => setTimeout(r, LOADER_EXIT_MS));
}
function fadeInPage() {
  app.classList.remove("app-enter");
  void app.offsetWidth;
  app.classList.add("app-enter");
  setTimeout(() => app.classList.remove("app-enter"), 600);
}

// What the panels showed last time (kept in IndexedDB) is drawn at once on
// the next load while the fresh data loads behind it, which then replaces
// it in place - the loading screen only when there's none (a first visit,
// a new device). Until then nothing on the page can be clicked
// (body.panels-stale, a thin bar moving along the top): a change made on
// the old data could be saved wrong.
const PANELS_SNAPSHOT_KEY = "panels-snapshot";
const PANELS_SNAPSHOT_MAX_MS = 7 * 24 * 60 * 60 * 1000;
let panelsFromSnapshot = false;
// Only when the page opens: a later main() (after a change, a restore)
// would otherwise put back panels from before that change for a moment.
let snapshotTried = false;
let snapshotSaveTimer = null;
function savePanelsSnapshotSoon() {
  clearTimeout(snapshotSaveTimer);
  snapshotSaveTimer = setTimeout(() => {
    if (panelsFromSnapshot || !lastBaseRows) return;
    writePersistedCache(PANELS_SNAPSHOT_KEY, {
      rows: lastBaseRows, totalEps: lastTotalEps, totalMinutes: lastTotalMinutes,
      recentlyWatched: lastRecentlyWatched, planToWatch: lastPlanToWatch, airingPreview: lastAiringPreview,
    });
  }, 1500);
}
async function showPanelsSnapshot() {
  if (snapshotTried) return false;
  snapshotTried = true;
  const snap = await Promise.race([readPersistedCache(PANELS_SNAPSHOT_KEY, PANELS_SNAPSHOT_MAX_MS), sleep(1000)]);
  if (!snap || !Array.isArray(snap.rows)) return false;
  panelsFromSnapshot = true;
  document.body.classList.add("panels-stale");
  try {
    renderRows(snap.rows, snap.totalEps, snap.totalMinutes, snap.recentlyWatched || [], snap.planToWatch || [], snap.airingPreview || []);
  } catch (e) {
    endPanelsSnapshot();
    return false;
  }
  fadeInPage();
  return true;
}
function endPanelsSnapshot() {
  panelsFromSnapshot = false;
  document.body.classList.remove("panels-stale");
}

// Keeps the posters on screen for the next loading screen.
function rememberLoaderPosters() {
  const urls = [];
  for (const rows of [lastRows, lastAiringPreview, lastRecentlyWatched, lastPlanToWatch]) {
    for (const r of rows || []) if (r && r.posterUrl && !urls.includes(r.posterUrl)) urls.push(r.posterUrl);
  }
  if (urls.length) safeSetItem(LS_LOADER_POSTERS, JSON.stringify(urls.slice(0, 12)));
}

// The loading screen's progress line follows the subtitle ("Loading
// episode lists… 37/130").
new MutationObserver(() => {
  const el = document.getElementById("loaderStatus");
  if (el) el.textContent = subtitle.textContent;
}).observe(subtitle, { childList: true, characterData: true, subtree: true });

// Phones (touch, and a narrow screen or a short one turned sideways) get a
// layout of their own, set by how the phone is held instead of by the
// Posters/Banners buttons (hidden there): upright, every panel is a row of
// banners swiped sideways; sideways, the posters in L-shaped pairs across
// the whole screen. A desktop window, however narrow, keeps its own
// settings: it has no coarse pointer.
const PHONE_PORTRAIT_QUERY = "(pointer: coarse) and (max-width: 720px)";
const PHONE_LANDSCAPE_QUERY = "(pointer: coarse) and (orientation: landscape) and (max-height: 500px)";
function phoneLayout() {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  if (window.matchMedia(PHONE_PORTRAIT_QUERY).matches) return "portrait";
  if (window.matchMedia(PHONE_LANDSCAPE_QUERY).matches) return "landscape";
  return null;
}

function getImageMode() {
  const phone = phoneLayout();
  if (phone) return phone === "portrait" ? "banner" : "poster";
  return localStorage.getItem(LS_IMAGE_MODE) === "banner" ? "banner" : "poster";
}

function nextImageMode(mode) {
  return mode === "poster" ? "banner" : "poster";
}

function getConfig() {
  return {
    clientId: localStorage.getItem(LS_CLIENT_ID) || "",
    clientIdV2: localStorage.getItem(LS_CLIENT_ID_V2) || "",
    mdblistKey: localStorage.getItem(LS_MDBLIST_KEY) || "",
    fanartKey: localStorage.getItem(LS_FANART_KEY) || "",
    tvdbKey: localStorage.getItem(LS_TVDB_KEY) || "",
    tmdbKey: localStorage.getItem(LS_TMDB_KEY) || "",
  };
}

// ---------------------------------------------------------------------
// Settings screen (first run, or via the Settings button)
// ---------------------------------------------------------------------
function returnToPreviousView() {
  if (currentView === "airing" && airingRows) {
    renderAiringRows(airingRows);
  } else {
    renderRows(lastRows || [], lastTotalEps, lastTotalMinutes, lastRecentlyWatched);
  }
}

// The settings screen's top-left corner: the version this page runs
// (version.js) and its date, and whether the site has a newer one live -
// read fresh from the server - so a deploy that hasn't reached this
// device yet shows.
function siteVersionHtml() {
  const v = window.SITE_VERSION || {};
  const date = v.date
    ? new Date(v.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "";
  return `<div class="settings-version"><b>Version ${v.number != null ? v.number : "?"}</b><span>${date}</span><em id="settingsVersionLive"></em></div>`;
}

async function checkLiveVersion() {
  const mine = window.SITE_VERSION && window.SITE_VERSION.number;
  try {
    const text = await (await fetch(`version.js?_v=${Date.now()}`, { cache: "no-store" })).text();
    const live = Number((text.match(/number:\s*(\d+)/) || [])[1]);
    const el = document.getElementById("settingsVersionLive");
    if (!el || !live || mine == null) return;
    el.textContent = live > mine ? `Version ${live} is live - refresh` : "Up to date";
    el.className = live > mine ? "behind" : "ok";
  } catch (e) { /* offline: the version alone */ }
}

function showSettings(afterSaveCallback) {
  document.getElementById("settingsBtn").classList.add("active");
  const cfg = getConfig();
  // Only offer a way back if there's actually a previously-loaded view to
  // return to - on first run (no config yet) there's nothing to cancel back
  // to, and both fields are required anyway.
  const canCancel = lastRows !== null || airingRows !== null;
  const closeBtnHtml = canCancel
    ? `<button class="modal-close-btn" id="settingsCloseBtn" style="position:absolute;top:14px;right:14px" title="Back">&times;</button>`
    : "";
  app.innerHTML = `
    <div class="center-box" style="position:relative">
      ${closeBtnHtml}
      ${siteVersionHtml()}
      <h2>Setup</h2>
      <p style="color:var(--muted);font-size:0.85rem">
        These are stored in this browser and with your account (in your own
        private database, so a new device or the Android app gets them once
        you sign in) - never written into the site's files, so it's safe to
        keep them in a public repo.
      </p>
      <label>SIMKL Client ID &mdash; optional: exact air times for streaming episodes, taken from SIMKL by the
        computer's Emby bridge (<a href="https://simkl.com/settings/developer/new/" target="_blank">create an app</a>,
        type &ldquo;TV, devices &amp; command line&rdquo;; then on that computer: <code>node run.js --simkl-login</code>)</label>
      <input type="text" id="clientIdV2Input" value="${esc(cfg.clientIdV2)}">
      <label>TMDB API Key
        (<a href="https://www.themoviedb.org/settings/api" target="_blank">get a free key</a>)</label>
      <input type="text" id="tmdbKeyInput" value="${cfg.tmdbKey}">
      <label>MDBList API Key &mdash; optional, adds Rotten Tomatoes and Trakt ratings
        (<a href="https://mdblist.com/preferences/" target="_blank">get a free key</a>)</label>
      <input type="text" id="mdblistKeyInput" value="${cfg.mdblistKey}">
      <label>Fanart.tv API Key &mdash; optional, adds more posters and banners to the image picker
        (<a href="https://fanart.tv/get-an-api-key/" target="_blank">get a free key</a>)</label>
      <input type="text" id="fanartKeyInput" value="${cfg.fanartKey}">
      <label>TheTVDB API Key &mdash; optional, adds more posters and backgrounds to the image picker, and checks
        new episodes' air dates against <a href="https://thetvdb.com" target="_blank">TheTVDB</a>
        (<a href="https://thetvdb.com/api-information" target="_blank">get a free key</a>)</label>
      <input type="text" id="tvdbKeyInput" value="${cfg.tvdbKey}">
      ${librarySettingsHtml()}
      <div class="theme-toggle-wrap" style="margin-top:18px">
        <span class="nav-icon"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg></span>
        <span style="flex:1 1 auto;text-align:left">Dark Mode</span>
        <button class="theme-toggle" id="themeToggleBtn" title="Toggle light/dark"></button>
      </div>
      <div class="theme-toggle-wrap" style="margin-top:12px">
        <span class="nav-icon"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="12" x2="21" y2="12"></line><line x1="12" y1="12" x2="12" y2="21"></line></svg></span>
        <span style="flex:1 1 auto;text-align:left">One-Page Layout</span>
        <button class="theme-toggle" id="layoutToggleBtn" title="Toggle one-page / scrolling bottom panels"></button>
      </div>
      <div style="margin-top:18px">
        <button class="pill" id="saveSettingsBtn">Save</button>
      </div>
      <div class="error-box" id="settingsError"></div>
    </div>
  `;
  subtitle.textContent = "Setup required";
  document.getElementById("saveSettingsBtn").onclick = () => {
    const clientIdV2 = document.getElementById("clientIdV2Input").value.trim();
    const tmdbKey = document.getElementById("tmdbKeyInput").value.trim();
    const mdblistKey = document.getElementById("mdblistKeyInput").value.trim();
    const fanartKey = document.getElementById("fanartKeyInput").value.trim();
    const tvdbKey = document.getElementById("tvdbKeyInput").value.trim();
    if (!tmdbKey) {
      document.getElementById("settingsError").textContent = "The TMDB key is required.";
      return;
    }
    safeSetItem(LS_CLIENT_ID_V2, clientIdV2);
    safeSetItem(LS_TMDB_KEY, tmdbKey);
    safeSetItem(LS_MDBLIST_KEY, mdblistKey);
    safeSetItem(LS_FANART_KEY, fanartKey);
    safeSetItem(LS_TVDB_KEY, tvdbKey);
    imageSources.resetRejected(); // new keys: Fanart.tv and TheTVDB are asked again
    if (mdblistKey !== cfg.mdblistKey) {
      mdblistCache.disabled = false;
      if (mdblistKey) {
        // safeSetItem swallows a full/blocked storage silently, so confirm the
        // key really landed, then confirm MDBList accepts it - otherwise a bad
        // key just looks like "nothing happened".
        if (localStorage.getItem(LS_MDBLIST_KEY) !== mdblistKey) {
          showToast("Couldn't store the MDBList key - this browser's storage is full or blocked.", true);
        } else {
          checkMdblistKey(mdblistKey);
        }
      }
    }
    if (afterSaveCallback) afterSaveCallback();
  };
  document.getElementById("themeToggleBtn").onclick = () => {
    const isLight = document.body.classList.toggle("light-theme");
    safeSetItem(LS_THEME, isLight ? "light" : "dark");
    updateThemeToggleButton();
  };
  updateThemeToggleButton();
  // Takes effect on the next render - closing Settings (returnToPreviousView)
  // or saving (main) both re-render the panels.
  document.getElementById("layoutToggleBtn").onclick = () => {
    safeSetItem(LS_PANEL_LAYOUT, isScrollLayout() ? "paged" : "scroll");
    applyPanelLayout();
  };
  updateLayoutToggleButton();
  wireLibrarySettings();
  checkLiveVersion();
  if (canCancel) {
    document.getElementById("settingsCloseBtn").onclick = returnToPreviousView;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
