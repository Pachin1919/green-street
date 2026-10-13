import { useEffect, useState } from "react";
import { ArrowRight, ArrowsLeftRight, ChartLineUp, CheckCircle, Compass, FileArrowUp, Gauge, Info, Leaf, ListChecks, LockKey, ShieldCheck, SlidersHorizontal, Sparkle, TrendUp } from "@phosphor-icons/react";
import Workbench from "./Workbench";
import Brand from "./Brand";
import { Button } from "./ui";

function MiniWorkbench() {
  return <div className="mini-workbench" aria-label="Portfolio metric preview">
    <div className="mini-sidebar"><span><Leaf size={17} weight="fill" /></span><i className="active" /><i /><i /></div>
    <div className="mini-content"><div className="mini-top"><span>Green-value analysis · Illustrative</span></div>
      <div className="mini-metrics"><div><small>Expected return</small><strong>7.51%</strong><span>Annual return</span></div><div><small>Green score</small><strong>6.73</strong><span>Environmental score</span></div><div><small>Volatility</small><strong>—</strong><span>Pending</span></div></div>
      <div className="mini-body"><div className="mini-chart environmental-drivers"><small>Environment &amp; financial performance</small><div><Leaf size={22}/><span>Operational efficiency</span></div><div><ShieldCheck size={22}/><span>Transition &amp; regulatory exposure</span></div><div><ChartLineUp size={22}/><span>Return expectations</span></div><p>Relationships to investigate, not guaranteed returns.</p></div>
      <div className="mini-recommendation"><span className="mini-tag"><Sparkle size={16}/> Recommended company</span><div className="mini-stock"><i>VS</i><div><strong>Verdant Solar</strong><small>Illustrative company</small></div></div><div className="mini-fit"><span>E-score</span><strong>8.80</strong></div><div className="mini-fit"><span>Expected return</span><strong>7.50%</strong></div></div></div>
    </div>
  </div>;
}

function LandingPage({ onOpenWorkspace, onOpenSettings }: { onOpenWorkspace: () => void; onOpenSettings: () => void }) {
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  const values = [
    { icon: ChartLineUp, title: "Understand environmental performance", text: "Explore how environmental practices can affect operating costs, transition exposure and future financial performance." },
    { icon: Sparkle, title: "Put returns in context", text: "Consider expected return alongside E-score. Higher environmental scores do not automatically mean higher investment returns." },
    { icon: ArrowsLeftRight, title: "Explore a portfolio change", text: "Use risk tolerance and green preference to explore candidates, then compare a potential investment with your current portfolio." },
  ];
  const steps = [
    { icon: SlidersHorizontal, title: "Set preferences", text: "Choose your risk tolerance, environmental priority and maximum investment budget." },
    { icon: FileArrowUp, title: "Import portfolio", text: "Upload your holdings in Current portfolio. Review dated exchange rates and convert supported currencies to HKD." },
    { icon: ListChecks, title: "Review recommendations", text: "Review stock candidates, their metrics and available reasons." },
    { icon: ListChecks, title: "Compare portfolios", text: "Review current and simulated return, green score and holding weights." },
  ];
  return <div className="landing">
    <header className="landing-nav"><Brand onHome={() => window.scrollTo({ top: 0, behavior: "smooth" })}/><nav aria-label="Landing navigation"><button onClick={() => go("value")}>Why Green Street</button><button onClick={() => go("how")}>How it works</button><button onClick={() => go("preview")}>Product</button><button onClick={() => go("trust")}>About</button></nav><Button kind="secondary" onClick={onOpenWorkspace}>Open workspace</Button></header>
    <main>
      <section className="landing-hero"><div className="hero-copy"><div className="eyebrow"><span/> GREEN-VALUE INVESTMENT ANALYSIS</div><h1>We make your wallet and the streets green</h1><p>Environmental performance can influence company costs, transition exposure and return expectations. Explore that relationship, then test a change to your portfolio.</p><div className="hero-actions"><Button onClick={onOpenWorkspace}>Current portfolio <ArrowRight size={18}/></Button></div><div className="hero-assurance"><ShieldCheck size={18}/> Explore first. Nothing is traded or submitted.</div></div>
      <div className="hero-visual"><div className="visual-glow"/><MiniWorkbench/><div className="floating-note note-one"><CheckCircle size={18} weight="fill"/><span><strong>Environment meets investment</strong>E-score + expected return</span></div><div className="floating-note note-two"><TrendUp size={18}/><span><strong>Compare before deciding</strong>Current vs. simulated portfolio</span></div></div></section>

      <section className="landing-section value-section" id="value"><div className="section-heading centered"><span className="section-kicker">ENVIRONMENTAL CONTEXT FOR INVESTMENT DECISIONS</span><h2>Understand the company behind the investment.</h2><p>Our focus is the link between corporate environmental performance and financial outcomes—interpreted with evidence and model limitations.</p></div><div className="value-grid">{values.map(({icon: Icon,title,text},i) => <article className="value-card" key={title}><span className="card-number">0{i+1}</span><span className="value-icon"><Icon size={25}/></span><h3>{title}</h3><p>{text}</p><div className="card-line"/></article>)}</div></section>

      <section className="landing-section process-section" id="how"><div className="process-intro"><span className="section-kicker">HOW IT WORKS</span><h2>A guided path from holdings to a considered next step.</h2><p>Four steps connect your preferences and holdings to a portfolio comparison.</p><Button kind="secondary" onClick={onOpenSettings}>Set preferences <ArrowRight/></Button></div><ol className="process-list">{steps.map(({icon: Icon,title,text},i) => <li key={title}><span className="step-number">0{i+1}</span><span className="step-icon"><Icon size={22}/></span><div><h3>{title}</h3><p>{text}</p></div>{i<steps.length-1&&<span className="step-connector"/>}</li>)}</ol></section>

      <section className="landing-section preview-section" id="preview"><div className="section-heading preview-heading"><div><span className="section-kicker">PRODUCT PREVIEW</span><h2>See the decision, not just the data.</h2></div><p>Review metrics, recommendations and portfolio comparisons in one workspace.</p></div>
      <div className="product-preview"><div className="preview-metrics"><div className="preview-label">ILLUSTRATIVE PORTFOLIO · 4 COMPANIES</div><h3>Portfolio at a glance</h3><div className="metric-cards"><div><span>Expected return <Info/></span><strong>7.51<small>%</small></strong><em>Annual expected return</em></div><div><span>Green score <Leaf/></span><strong>6.73</strong><em>Environmental performance</em></div><div><span>Volatility <Gauge/></span><strong>—</strong><em>Portfolio risk</em></div></div><div className="allocation-bars">{[29.8,25.5,21.3,23.4].map((v,i)=><i key={v} style={{width:`${v}%`,background:["#5487bb","#65a593","#8d9dca","#bb8f45"][i]}}/>)}</div><div className="allocation-legend"><span>Portfolio allocation</span><span>100%</span></div></div>
      <div className="preview-picks"><div className="preview-label">ILLUSTRATIVE RECOMMENDATION</div><span className="match-pill"><Sparkle/> Recommended company</span><div className="pick-title"><i>VS</i><div><h3>Verdant Solar</h3><p>Illustrative company · VS</p></div></div><p className="pick-reason">Review environmental performance alongside expected return.</p><div className="pick-stats"><span>E-score<strong>8.80</strong></span><span>Expected return<strong>7.50% · annual return</strong></span></div></div>
      <div className="preview-compare"><div className="preview-label">ILLUSTRATIVE COMPARISON</div><h3>Before and after</h3><div className="compare-row"><span>Expected return</span><strong>7.511%</strong><ArrowRight/><strong>7.510%</strong></div><div className="compare-row"><span>Green score</span><strong>6.73</strong><ArrowRight/><strong>6.93</strong></div><div className="compare-row"><span>Volatility</span><strong>—</strong><ArrowRight/><strong>—</strong></div><div className="simulated-note"><CheckCircle/> Investment amount: HK$10,000</div></div></div></section>

      <section className="trust-section" id="trust"><div className="trust-copy"><span className="section-kicker">METHOD & TRUST</span><h2>Clear about what the model can—and cannot—tell you.</h2><p>Consider environmental performance alongside expected return, then review the effect of a proposed investment on your portfolio.</p><div className="trust-actions"><Button onClick={onOpenWorkspace}>Current portfolio <ArrowRight/></Button></div></div><div className="trust-grid">{[
        {icon:Leaf,title:"Environmental scoring",text:"Higher E-score indicates stronger environmental performance. Review it alongside financial metrics."},
        {icon:ChartLineUp,title:"Modeled expected return",text:"Company environmental performance may affect return expectations; the direction and size require a validated model."},
        {icon:Compass,title:"Source transparency",text:"Scores are designed to link back to underlying company, market and methodology sources."},
        {icon:LockKey,title:"Current scope",text:"Review holdings and compare proposed portfolio changes before making an investment decision."},
      ].map(({icon:Icon,title,text})=><article key={title}><span><Icon/></span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div></section>
    </main><footer className="landing-footer"><Brand onHome={()=>window.scrollTo({top:0,behavior:"smooth"})} light/><p>Portfolio insight for more considered investing.</p><span>Portfolio analysis · Environmental insights</span></footer>
  </div>;
}


export default function App() {
  const initialWorkspace = location.pathname.startsWith("/app") || new URLSearchParams(location.search).get("v") === "blue";
  const [screen, setScreen] = useState<"landing" | "workspace">(initialWorkspace ? "workspace" : "landing");
  const [entry, setEntry] = useState<"demo" | "resume" | "settings">(new URLSearchParams(location.search).get("v") === "blue" ? "demo" : "resume");
  useEffect(() => {
    const back = () => { setEntry("resume"); setScreen(location.pathname.startsWith("/app") ? "workspace" : "landing"); };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = screen; window.scrollTo(0, 0); }, [screen]);
  const enter = (mode: "resume" | "settings" = "resume") => { setEntry(mode); history.pushState({}, "", "/app"); setScreen("workspace"); };
  const home = () => { history.pushState({}, "", "/"); setScreen("landing"); };
  return screen === "landing" ? <LandingPage onOpenWorkspace={() => enter()} onOpenSettings={() => enter("settings")} /> : <Workbench entry={entry} onHome={home} />;
}
