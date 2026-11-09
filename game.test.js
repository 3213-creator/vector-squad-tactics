import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,act} from './game.js';
test('turn, ownership, occupied tiles and AP are enforced',()=>{const s=initial();assert.equal(s.units.length,10);assert.throws(()=>act(s,1,{type:'move',id:5,x:9,z:2}));assert.throws(()=>act(s,0,{type:'move',id:5,x:9,z:2}));act(s,0,{type:'move',id:0,x:2,z:2});act(s,0,{type:'move',id:0,x:3,z:2});assert.throws(()=>act(s,0,{type:'move',id:0,x:3,z:3}));act(s,0,{type:'end'});assert.equal(s.turn,1);assert.equal(s.units[5].ap,2);});
test('range, cover, damage and victory',()=>{const s=initial();assert.throws(()=>act(s,0,{type:'attack',id:0,target:5}));s.units[0].x=3;s.units[0].z=3;s.units[5].x=5;s.units[5].z=3;assert.throws(()=>act(s,0,{type:'attack',id:0,target:5}));s.units[0].z=2;s.units[5].z=2;s.units.filter(u=>u.team===1).forEach(u=>u.hp=0);s.units[5].hp=35;act(s,0,{type:'attack',id:0,target:5});assert.equal(s.winner,0);assert.throws(()=>act(s,0,{type:'end'}));});
