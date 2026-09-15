import assert from 'node:assert/strict';
const { rankPages, objectsForPage, fuzzy } = require('./public/recording-review.js');
const pages = [
  { name: 'LandingPage', route: '/home', description: 'Welcome and navigation' },
  { name: 'DashboardPage', route: '/home', description: 'Summary and reports' },
  { name: 'HeaderPage', route: '', description: 'Reusable across routes' },
  { name: 'OrderPage', route: '/orders/:id', description: 'Order details' },
];
const before = JSON.stringify(pages);
assert.deepEqual(rankPages(pages, { route:'/home' }).map((p:any)=>p.name), ['DashboardPage','LandingPage']);
assert.deepEqual(rankPages(pages, { route:'/home',current:'HeaderPage',recent:['LandingPage'] }).map((p:any)=>p.name), ['HeaderPage','LandingPage','DashboardPage']);
assert.deepEqual(rankPages(pages, { route:'/orders/123' }).map((p:any)=>p.name), ['OrderPage']);
for (const [query,name] of [['Landing','LandingPage'],['reports','DashboardPage'],['/orders','OrderPage'],['LndingPge','LandingPage']]) assert.ok(rankPages(pages,{query}).some((p:any)=>p.name===name));
assert.equal(rankPages(pages,{route:'/unknown'}).length,0);assert.equal(rankPages(pages,{route:'/unknown',all:true}).length,4);
assert.equal(JSON.stringify(pages),before,'ranking never changes selection or catalog');
console.log('PASS route relevance, same-route logical Pages, recent/current ranking, fuzzy name/route/description search and View all');
const objects=[{className:'LoginHeader',page:'LandingPage',file:'LoginHeader.ts',methods:[{name:'entryLink'}]}, {className:'Reports',page:'DashboardPage',file:'Reports.ts',methods:[{name:'summary'}]}];
for(const term of ['Login','entryLink','LoginHeader.ts'])assert.equal(objectsForPage(objects,'LandingPage',term)[0]?.className,'LoginHeader');
assert.equal(objectsForPage(objects,'LandingPage','Reports').length,0,'unrelated logical Page objects must remain hidden');assert.equal(objectsForPage(objects,'NewPage').length,0);
console.log('PASS Page Object association filtering, method/source search and empty new Page');
const large=Array.from({length:1000},(_,i)=>({name:'Screen'+i,route:'/screens/'+i,description:'Large synthetic catalog'}));
const start=performance.now();for(let i=0;i<10;i++)assert.ok(rankPages(large,{query:'Screen9',all:true}).length>0);
assert.equal(fuzzy('xyz','LandingPage'),false);
console.log(`PASS stable local search across 1000 Pages (${(performance.now()-start).toFixed(1)}ms for ten searches)`);
