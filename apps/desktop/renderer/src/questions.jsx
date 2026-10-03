import React, { useMemo, useRef, useState } from "react";
import { Check, LoaderCircle, MessageCircleQuestion, Send, Sparkles } from "lucide-react";
import { cx } from "./core.jsx";

const FENCE="```intrebari";
export const PICK_FOR_ME="Alege tu variantele potrivite și continuă.";
export const ANSWERS_PREFIX="Răspunsurile mele:";
const RECOMMENDED=/\s*\((recomandat|recomandată)\)\s*$/i;

export function parseQuestions(json){
  let data;
  try{data=JSON.parse(String(json||"").trim())}catch{return null}
  const list=Array.isArray(data?.questions)?data.questions:Array.isArray(data)?data:null;
  if(!list)return null;
  const questions=list.slice(0,3).map(q=>{
    const question=typeof q?.question==="string"?q.question.trim():"";
    const options=(Array.isArray(q?.options)?q.options:[]).map(o=>typeof o==="string"?{label:o.trim(),description:""}:{label:String(o?.label||"").trim(),description:typeof o?.description==="string"?o.description.trim():""}).filter(o=>o.label).slice(0,4).map(o=>({label:o.label.slice(0,80),description:o.description.slice(0,240)}));
    if(!question||options.length<2)return null;
    return {header:String(q?.header||"").trim().slice(0,12),question:question.slice(0,300),multiSelect:q?.multiSelect===true,options};
  }).filter(Boolean);
  return questions.length?{questions}:null;
}

// Splits an assistant message around a ```intrebari block: {before, after, questions} | {before, pending:true} | null.
export function splitQuestions(text,streaming){
  const s=String(text||"");
  const i=s.indexOf(FENCE);
  if(i<0)return null;
  const rest=s.slice(i+FENCE.length),nl=rest.indexOf("\n");
  if(nl<0||/\S/.test(rest.slice(0,nl)))return streaming&&nl<0?{before:s.slice(0,i),pending:true}:null;
  const body=rest.slice(nl+1),end=body.search(/^```\s*$/m);
  if(end<0)return streaming?{before:s.slice(0,i),pending:true}:null;
  const parsed=parseQuestions(body.slice(0,end));
  if(!parsed)return null;
  return {before:s.slice(0,i),after:body.slice(end).replace(/^```[^\n]*\n?/,""),questions:parsed.questions};
}

export function answerLabel(label){return String(label||"").replace(RECOMMENDED,"").trim();}
export function formatAnswers(questions,answers){
  return [ANSWERS_PREFIX,...questions.map((q,i)=>{
    const a=answers[i]||{},picked=q.options.filter((_,j)=>a.selected?.includes(j)).map(o=>answerLabel(o.label));
    if(a.other&&String(a.otherText||"").trim())picked.push(String(a.otherText).trim());
    return `- ${q.header||q.question}: ${picked.join(", ")}`;
  })].join("\n");
}
function parseAnswers(text,questions){
  const s=String(text||"").trim();
  if(s===PICK_FOR_ME)return {auto:true};
  if(!s.startsWith(ANSWERS_PREFIX))return null;
  const lines=s.split("\n").slice(1).map(l=>l.replace(/^-\s*/,""));
  return {byQuestion:questions.map((q,i)=>{
    const key=q.header||q.question;
    const line=lines.find(l=>l.startsWith(key+":"))??lines[i]??"";
    return line.slice(line.indexOf(":")+1).split(",").map(x=>x.trim()).filter(Boolean);
  })};
}

function isAnswered(q,a){return !!a&&((a.selected?.length||0)>0||(a.other&&String(a.otherText||"").trim().length>0));}

export function QuestionCard({questions,answeredWith=null,disabled=false,onSubmit}){
  const readOnly=answeredWith!==null;
  const [answers,setAnswers]=useState(()=>questions.map(()=>({selected:[],other:false,otherText:""})));
  const groupRefs=useRef([]);
  const parsed=useMemo(()=>readOnly?parseAnswers(answeredWith,questions):null,[readOnly,answeredWith,questions]);
  const ready=questions.every((q,i)=>isAnswered(q,answers[i]));
  function update(i,fn){setAnswers(list=>list.map((a,j)=>j===i?fn(a):a))}
  function pick(i,j){
    if(readOnly||disabled)return;
    const q=questions[i];
    update(i,a=>q.multiSelect?{...a,selected:a.selected.includes(j)?a.selected.filter(x=>x!==j):[...a.selected,j]}:{...a,selected:[j],other:false});
  }
  function pickOther(i){
    if(readOnly||disabled)return;
    const q=questions[i];
    update(i,a=>q.multiSelect?{...a,other:!a.other}:{...a,selected:[],other:true});
    setTimeout(()=>groupRefs.current[i]?.querySelector(".questionOtherInput")?.focus(),0);
  }
  function onGroupKey(e,i){
    if(readOnly)return;
    if(e.target.tagName==="INPUT")return;
    const opts=[...(groupRefs.current[i]?.querySelectorAll(".questionOption")||[])];
    const idx=opts.indexOf(document.activeElement);
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();const next=opts[(idx+(e.key==="ArrowDown"?1:-1)+opts.length)%opts.length];next?.focus();return;}
    const n=Number(e.key);
    if(Number.isInteger(n)&&n>=1&&n<=opts.length){e.preventDefault();opts[n-1].focus();if(n-1<questions[i].options.length)pick(i,n-1);else pickOther(i);}
  }
  function submit(){if(ready&&!disabled&&!readOnly)onSubmit?.(formatAnswers(questions,answers))}
  const chosen=(i,j)=>readOnly?!!parsed?.byQuestion?.[i]?.includes(answerLabel(questions[i].options[j].label)):answers[i].selected.includes(j);
  const otherChosen=i=>{
    if(!readOnly)return answers[i].other;
    const labels=questions[i].options.map(o=>answerLabel(o.label));
    return (parsed?.byQuestion?.[i]||[]).filter(x=>!labels.includes(x));
  };
  return <div className={cx("questionCard",readOnly&&"answered")} onKeyDown={e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();submit()}}}>
    <div className="questionCardHead"><MessageCircleQuestion size={16}/><span>{readOnly?(parsed?.auto?"Ai lăsat AI Stoica să aleagă":"Răspunsurile tale"):"Câteva întrebări înainte să încep"}</span></div>
    {questions.map((q,i)=>{
      const other=otherChosen(i);
      return <div className="questionBlock" key={i}>
        {q.header&&<span className="questionChip">{q.header}</span>}
        <p className="questionText" id={`q-${i}-${q.question.length}`}>{q.question}{q.multiSelect&&!readOnly&&<small> (poți alege mai multe)</small>}</p>
        <div className="questionOptions" role={q.multiSelect?"group":"radiogroup"} aria-labelledby={`q-${i}-${q.question.length}`} ref={el=>{groupRefs.current[i]=el}} onKeyDown={e=>onGroupKey(e,i)}>
          {q.options.map((o,j)=>{const on=chosen(i,j);return <button type="button" key={j} className={cx("questionOption",on&&"selected")} role={q.multiSelect?"checkbox":"radio"} aria-checked={on} aria-disabled={readOnly||disabled} tabIndex={readOnly?-1:0} onClick={()=>pick(i,j)}>
            <span className={cx("questionMark",q.multiSelect?"box":"dot")} aria-hidden="true">{on&&(q.multiSelect?<Check size={12}/>:<i/>)}</span>
            <span className="questionLabel"><b>{o.label}</b>{o.description&&<small>{o.description}</small>}</span>
            {!readOnly&&<kbd aria-hidden="true">{j+1}</kbd>}
          </button>})}
          {readOnly?(Array.isArray(other)&&other.length>0&&<div className="questionOption selected static"><span className="questionMark dot" aria-hidden="true"><i/></span><span className="questionLabel"><b>Altceva</b><small>{other.join(", ")}</small></span></div>)
            :<div className={cx("questionOtherWrap",other&&"selected")}>
              <button type="button" className={cx("questionOption",other&&"selected")} role={q.multiSelect?"checkbox":"radio"} aria-checked={!!other} aria-disabled={disabled} onClick={()=>pickOther(i)}>
                <span className={cx("questionMark",q.multiSelect?"box":"dot")} aria-hidden="true">{other&&(q.multiSelect?<Check size={12}/>:<i/>)}</span>
                <span className="questionLabel"><b>Altceva…</b><small>Scrie propriul răspuns</small></span>
                <kbd aria-hidden="true">{q.options.length+1}</kbd>
              </button>
              {other&&<input className="questionOtherInput" value={answers[i].otherText} onChange={e=>update(i,a=>({...a,otherText:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();submit()}}} placeholder="Scrie răspunsul tău" aria-label={`Alt răspuns: ${q.question}`} disabled={disabled}/>}
            </div>}
        </div>
      </div>;
    })}
    {!readOnly&&<div className="questionActions">
      <button type="button" className="secondary" onClick={()=>!disabled&&onSubmit?.(PICK_FOR_ME)} disabled={disabled}><Sparkles size={14}/> Alege tu</button>
      <button type="button" className="primary" onClick={submit} disabled={!ready||disabled}><Send size={14}/> Trimite</button>
    </div>}
  </div>;
}

export function QuestionsPending(){
  return <div className="questionCard pending" role="status"><LoaderCircle size={16} className="spin"/> Pregătesc întrebările…</div>;
}
