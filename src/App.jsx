import { useState, useRef, useEffect } from 'react'
import { db } from './firebase'
import { collection, addDoc, getDocs, orderBy, query, doc, deleteDoc } from 'firebase/firestore'

const PERGUNTAS = [
  "Quais ferramentas de dados e BI você mais usa no dia a dia? Me conta como você as utiliza no trabalho.",
  "Me dá um exemplo de uma análise que você fez e que ajudou alguém a tomar uma decisão importante.",
  "Você já acompanhou metas ou ajudou a estruturar incentivos para times de vendas ou CS? Como foi?",
  "Como você usa IA no seu dia a dia — tanto no trabalho quanto na vida pessoal?"
]

const SENHA_PAINEL = "@Waid2626"
const VAGA_TITULO = "Sales Operations"

async function avaliarRespostas(apiKey, nome, respostas) {
  const prompt = `Você é um recrutador especialista da Curseduca, uma EdTech brasileira em crescimento.
Avalie as respostas do candidato "${nome}" para a vaga de ${VAGA_TITULO}.

${respostas.map((r, i) => `Pergunta ${i+1}: ${PERGUNTAS[i]}\nResposta: ${r.texto}\n`).join('\n')}

Critérios: domínio de dados e BI, capacidade analítica, experiência com metas e incentivos, uso de IA, fit cultural com startup.

Responda APENAS em JSON válido:
{"score":<0-100>,"classificacao":"<✅ Avança | 🟡 Talvez | ❌ Não avança>","pontos_fortes":["..."],"alertas":["..."],"resumo":"<2 frases>"}`

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }]
      })
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error.message)
    const text = data.content?.[0]?.text || "{}"
    return JSON.parse(text.replace(/```json|```/g, "").trim())
  } catch {
    return { score: 50, classificacao: "🟡 Talvez", pontos_fortes: [], alertas: ["Avaliação automática indisponível"], resumo: "Avalie manualmente." }
  }
}

function TelaCandidato({ apiKey, onFinalizar }) {
  const [nome, setNome] = useState("")
  const [iniciado, setIniciado] = useState(false)
  const [pergAtual, setPergAtual] = useState(0)
  const [respostas, setRespostas] = useState([])
  const [texto, setTexto] = useState("")
  const [textoFinalizado, setTextoFinalizado] = useState("")
  const [gravando, setGravando] = useState(false)
  const [avaliando, setAvaliando] = useState(false)
  const [concluido, setConcluido] = useState(false)
  const recRef = useRef(null)
  const textoRef = useRef("")
  const [editando, setEditando] = useState(false)

  const iniciarGravacao = async () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      alert("Seu navegador não suporta gravação de voz. Por favor, use o Google Chrome no computador.")
      return
    }
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch(err) {
      alert("Permissão de microfone negada. Por favor, clique no ícone de cadeado na barra do navegador e permita o acesso ao microfone.")
      return
    }
    if (recRef.current) { try { recRef.current.abort() } catch {} }
    const base = textoFinalizado.trim()
    textoRef.current = base
    setTexto(base)
    setEditando(false)
    const r = new SR()
    r.lang = 'pt-BR'; r.continuous = true; r.interimResults = true
    r.onresult = (e) => {
      const todosFinais = Array.from(e.results).filter(x => x.isFinal).map(x => x[0].transcript).join(' ')
      const interim = Array.from(e.results).filter(x => !x.isFinal).map(x => x[0].transcript).join(' ')
      const novoTexto = base ? base + ' ' + todosFinais : todosFinais
      textoRef.current = novoTexto
      setTexto(novoTexto + (interim ? ' ' + interim : ''))
    }
    r.onerror = (e) => {
      setGravando(false)
      if (e.error === 'not-allowed') alert("Microfone bloqueado. Clique no cadeado na barra do Chrome e permita o microfone.")
      else if (e.error === 'network') alert("Erro de rede. Verifique sua conexão e tente novamente.")
      else if (e.error !== 'aborted' && e.error !== 'no-speech') alert("Erro ao gravar: " + e.error)
    }
    r.onend = () => {
      setGravando(false)
      setTexto(textoRef.current)
      setTextoFinalizado(textoRef.current)
      setEditando(true)
    }
    try {
      recRef.current = r
      r.start()
      setGravando(true)
    } catch(err) {
      alert("Não foi possível iniciar a gravação: " + err.message)
    }
  }

  const pararGravacao = () => {
    setGravando(false)
    if (recRef.current) { try { recRef.current.stop() } catch {} recRef.current = null }
    setTexto(textoRef.current)
    setTextoFinalizado(textoRef.current)
    setEditando(true)
  }

  const proximaPergunta = async () => {
    const textoFinal = texto.trim()
    if (!textoFinal) return
    if (gravando) pararGravacao()
    setTexto("")
    setTextoFinalizado("")
    const novas = [...respostas, { texto: textoFinal }]
    setRespostas(novas)
    if (pergAtual + 1 < PERGUNTAS.length) {
      setPergAtual(pergAtual + 1)
    } else {
      setAvaliando(true)
      const aval = await avaliarRespostas(apiKey, nome, novas)
      await addDoc(collection(db, "candidatos"), {
        nome,
        respostas: novas,
        avaliacao: aval,
        data: new Date().toLocaleDateString("pt-BR"),
        timestamp: new Date()
      })
      setAvaliando(false); setConcluido(true)
      onFinalizar()
    }
  }

  const s = {
    page: { minHeight:'100vh', background:'linear-gradient(135deg,#0f172a,#1e293b)', display:'flex', alignItems:'center', justifyContent:'center', padding:'20px', fontFamily:'system-ui,sans-serif' },
    box: { background:'white', borderRadius:'16px', padding:'40px', maxWidth:'600px', width:'100%', boxShadow:'0 25px 50px rgba(0,0,0,.3)' },
    btn: { background:'#7c3aed', color:'white', border:'none', borderRadius:'10px', padding:'14px', fontSize:'16px', fontWeight:'600', cursor:'pointer', width:'100%', marginTop:'16px' },
    btnR: { background:'#dc2626', color:'white', border:'none', borderRadius:'10px', padding:'12px 20px', fontSize:'14px', fontWeight:'600', cursor:'pointer' },
    btnG: { background:'#f1f5f9', color:'#475569', border:'none', borderRadius:'10px', padding:'12px 20px', fontSize:'14px', fontWeight:'600', cursor:'pointer' },
    inp: { width:'100%', padding:'12px 16px', border:'2px solid #e2e8f0', borderRadius:'10px', fontSize:'16px', boxSizing:'border-box', outline:'none' },
    ta: { width:'100%', padding:'12px 16px', border:'2px solid #e2e8f0', borderRadius:'10px', fontSize:'15px', boxSizing:'border-box', minHeight:'120px', resize:'vertical', outline:'none', fontFamily:'inherit' },
    bar: { background:'#e2e8f0', borderRadius:'99px', height:'8px', margin:'0 0 32px' },
    barIn: (p) => ({ background:'#7c3aed', borderRadius:'99px', height:'8px', width:`${p}%`, transition:'width .4s' }),
    qbox: { background:'#f8fafc', borderRadius:'12px', padding:'20px', margin:'0 0 24px', borderLeft:'4px solid #7c3aed' },
    badge: { display:'inline-block', background:'#ede9fe', color:'#7c3aed', borderRadius:'99px', padding:'4px 12px', fontSize:'12px', fontWeight:'600', margin:'0 0 16px' },
    row: { display:'flex', gap:'12px', marginTop:'16px', alignItems:'center' },
    aviso: { background:'#f0fdf4', borderRadius:'12px', padding:'16px 20px', marginBottom:'24px', borderLeft:'4px solid #16a34a' }
  }

  if (concluido) return (
    <div style={s.page}><div style={{...s.box,textAlign:'center'}}>
      <div style={{fontSize:'64px',marginBottom:'16px'}}>✅</div>
      <h2 style={{fontSize:'22px',fontWeight:'700',color:'#0f172a'}}>Triagem concluída!</h2>
      <p style={{color:'#64748b',marginTop:'8px'}}>Obrigado, {nome}! Nossa equipe entrará em contato em breve.</p>
    </div></div>
  )

  if (avaliando) return (
    <div style={s.page}><div style={{...s.box,textAlign:'center'}}>
      <div style={{fontSize:'48px',marginBottom:'16px'}}>⏳</div>
      <h2 style={{fontSize:'22px',fontWeight:'700'}}>Analisando respostas...</h2>
    </div></div>
  )

  if (!iniciado) return (
    <div style={s.page}>
      <div style={s.box}>
        <div style={{textAlign:'center',marginBottom:'24px'}}>
          <div style={{fontSize:'48px',marginBottom:'12px'}}>👋</div>
          <h1 style={{fontSize:'24px',fontWeight:'700',color:'#0f172a',margin:'0 0 8px'}}>{VAGA_TITULO}</h1>
          <p style={{color:'#64748b',fontSize:'14px',margin:0}}>Curseduca • Processo Seletivo</p>
        </div>
        <div style={s.aviso}>
          <p style={{margin:'0 0 8px',fontSize:'14px',color:'#15803d',lineHeight:'1.7'}}>Olá! Antes de começar, queremos ser transparentes: essa é uma etapa experimental do nosso processo seletivo.</p>
          <p style={{margin:'0 0 8px',fontSize:'14px',color:'#15803d',lineHeight:'1.7'}}>Estamos testando novas formas de tornar a triagem mais ágil, utilizando ferramentas de inovação, e a sua participação é fundamental pra isso.</p>
          <p style={{margin:0,fontSize:'14px',color:'#15803d',lineHeight:'1.7'}}>Responda com calma e naturalidade. Obrigado por fazer parte dessa inovação com a gente! 🙌</p>
        </div>
        <p style={{color:'#475569',marginBottom:'24px',lineHeight:'1.6'}}>Você vai responder <strong>{PERGUNTAS.length} perguntas</strong> por áudio. Use o <strong>Google Chrome</strong> no computador para melhor experiência.</p>
        <input style={s.inp} placeholder="Seu nome completo" value={nome} onChange={e=>setNome(e.target.value)} onKeyDown={e=>e.key==='Enter'&&nome.trim()&&setIniciado(true)} />
        <button style={{...s.btn,opacity:nome.trim()?1:.5}} onClick={()=>nome.trim()&&setIniciado(true)}>Começar →</button>
      </div>
    </div>
  )

  return (
    <div style={s.page}>
      <div style={s.box}>
        <span style={s.badge}>Pergunta {pergAtual+1} de {PERGUNTAS.length}</span>
        <div style={s.bar}><div style={s.barIn((pergAtual/PERGUNTAS.length)*100)} /></div>
        <div style={s.qbox}><p style={{margin:0,fontSize:'17px',fontWeight:'600',color:'#1e293b',lineHeight:'1.5'}}>{PERGUNTAS[pergAtual]}</p></div>
        {gravando ? (
          <div style={{background:'#f8fafc',borderRadius:'10px',padding:'16px',minHeight:'100px',marginBottom:'8px',fontSize:'15px',color:texto.trim()?'#1e293b':'#94a3b8',lineHeight:'1.6',border:'2px solid #dc2626'}}>
            {texto.trim() || 'A transcrição vai aparecer aqui enquanto você fala...'}
          </div>
        ) : (
          <textarea
            style={{width:'100%',padding:'14px 16px',border:'2px solid',borderColor:editando?'#7c3aed':'#e2e8f0',borderRadius:'10px',fontSize:'15px',boxSizing:'border-box',minHeight:'120px',resize:'vertical',outline:'none',fontFamily:'inherit',lineHeight:'1.6',background:'#f8fafc',marginBottom:'8px'}}
            placeholder="A transcrição vai aparecer aqui enquanto você fala..."
            value={texto}
            onChange={e=>{ setTexto(e.target.value); textoRef.current = e.target.value; setTextoFinalizado(e.target.value) }}
          />
        )}
        {gravando && <p style={{color:'#dc2626',fontSize:'13px',margin:'0 0 12px'}}>🔴 Gravando... clique "Parar" quando terminar.</p>}
        {!gravando && editando && <p style={{color:'#7c3aed',fontSize:'13px',margin:'0 0 12px'}}>✏️ Corrija o texto se precisar, depois avance.</p>}
        {!gravando && !editando && texto.trim() && <p style={{color:'#64748b',fontSize:'13px',margin:'0 0 12px'}}>✅ Gravação finalizada.</p>}
        <div style={s.row}>
          {!gravando ? (
            <button style={s.btnG} onClick={iniciarGravacao}>
              {texto.trim() ? '🎙 Gravar mais' : '🎙 Gravar resposta'}
            </button>
          ) : (
            <button style={s.btnR} onClick={pararGravacao}>⏹ Parar</button>
          )}
          <button style={{...s.btn,marginTop:0,flex:1,opacity:texto.trim()&&!gravando?1:.4}} onClick={proximaPergunta} disabled={!texto.trim()||gravando}>
            {pergAtual+1 < PERGUNTAS.length ? 'Próxima →' : 'Enviar ✓'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Painel({ onVoltar }) {
  const [senha, setSenha] = useState("")
  const [auth, setAuth] = useState(false)
  const [candidatos, setCandidatosState] = useState([])
  const [exp, setExp] = useState(null)
  const [filtro, setFiltro] = useState("todos")
  const [carregando, setCarregando] = useState(false)

  const carregarCandidatos = async () => {
    setCarregando(true)
    try {
      const q = query(collection(db, "candidatos"), orderBy("timestamp", "desc"))
      const snap = await getDocs(q)
      setCandidatosState(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch(e) {
      alert("Erro ao carregar: " + e.message)
    }
    setCarregando(false)
  }

  useEffect(() => { if (auth) carregarCandidatos() }, [auth])

  const deletarCandidato = async (id, e) => {
    e.stopPropagation()
    if (!confirm("Apagar esse candidato?")) return
    try {
      await deleteDoc(doc(db, "candidatos", id))
      setCandidatosState(prev => prev.filter(x => x.id !== id))
    } catch(e) {
      alert("Erro ao apagar: " + e.message)
    }
  }

  const s = {
    page: { minHeight:'100vh', background:'#f8fafc', fontFamily:'system-ui,sans-serif', padding:'32px 20px' },
    card: { background:'white', borderRadius:'12px', padding:'20px', maxWidth:'900px', margin:'0 auto 16px', boxShadow:'0 1px 3px rgba(0,0,0,.1)', cursor:'pointer' },
    btn: { background:'#7c3aed', color:'white', border:'none', borderRadius:'8px', padding:'10px 20px', fontSize:'14px', fontWeight:'600', cursor:'pointer' },
    out: { background:'white', color:'#475569', border:'1px solid #e2e8f0', borderRadius:'8px', padding:'10px 20px', fontSize:'14px', cursor:'pointer' },
    sc: (n) => ({ display:'inline-block', background:n>=70?'#dcfce7':n>=50?'#fef9c3':'#fee2e2', color:n>=70?'#16a34a':n>=50?'#ca8a04':'#dc2626', borderRadius:'99px', padding:'4px 14px', fontSize:'13px', fontWeight:'700' }),
    inp: { width:'100%', padding:'12px 16px', border:'2px solid #e2e8f0', borderRadius:'10px', fontSize:'16px', boxSizing:'border-box', outline:'none', marginBottom:'16px' }
  }

  if (!auth) return (
    <div style={{...s.page,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{background:'white',borderRadius:'16px',padding:'40px',maxWidth:'400px',width:'100%',boxShadow:'0 10px 30px rgba(0,0,0,.1)'}}>
        <h2 style={{fontSize:'20px',fontWeight:'700',marginBottom:'8px'}}>Painel G&C</h2>
        <p style={{color:'#64748b',marginBottom:'24px',fontSize:'14px'}}>Acesso restrito à equipe Curseduca</p>
        <input style={s.inp} type="password" placeholder="Senha" value={senha} onChange={e=>setSenha(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&senha===SENHA_PAINEL) setAuth(true)}} />
        <button style={{...s.btn,width:'100%'}} onClick={()=>{if(senha===SENHA_PAINEL) setAuth(true); else alert("Senha incorreta")}}>Entrar</button>
        <button style={{...s.out,width:'100%',marginTop:'12px'}} onClick={onVoltar}>← Voltar</button>
      </div>
    </div>
  )

  const lista = filtro==="todos" ? candidatos : candidatos.filter(x=>x.avaliacao?.classificacao?.includes(filtro==="avanca"?"Avança":filtro==="talvez"?"Talvez":"Não avança"))

  return (
    <div style={s.page}>
      <div style={{maxWidth:'900px',margin:'0 auto 32px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div>
          <h1 style={{fontSize:'22px',fontWeight:'700',color:'#0f172a'}}>Painel G&C — {VAGA_TITULO}</h1>
          <p style={{color:'#64748b',fontSize:'14px',marginTop:'4px'}}>{candidatos.length} candidato(s)</p>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <button style={s.btn} onClick={carregarCandidatos} disabled={carregando}>{carregando ? "Carregando..." : "🔄 Atualizar"}</button>
          <button style={s.out} onClick={onVoltar}>← Voltar</button>
        </div>
      </div>
      <div style={{maxWidth:'900px',margin:'0 auto 24px',display:'flex',gap:'8px',flexWrap:'wrap'}}>
        {[["todos","Todos"],["avanca","✅ Avança"],["talvez","🟡 Talvez"],["nao","❌ Não avança"]].map(([v,l])=>(
          <button key={v} onClick={()=>setFiltro(v)} style={{...s.btn,background:filtro===v?'#7c3aed':'white',color:filtro===v?'white':'#475569',border:'1px solid #e2e8f0',padding:'8px 16px'}}>{l}</button>
        ))}
      </div>
      {lista.length===0 && <div style={{...s.card,textAlign:'center',color:'#64748b',padding:'40px'}}>Nenhum candidato ainda.</div>}
      {lista.map((x,i)=>(
        <div key={i} style={s.card} onClick={()=>setExp(exp===i?null:i)}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div><strong style={{fontSize:'16px'}}>{x.nome}</strong><span style={{marginLeft:'12px',color:'#94a3b8',fontSize:'13px'}}>{x.data}</span></div>
            <div style={{display:'flex',gap:'10px',alignItems:'center'}}>
              <span style={s.sc(x.avaliacao?.score||0)}>{x.avaliacao?.score||'?'}/100</span>
              <span style={{fontSize:'18px'}}>{x.avaliacao?.classificacao?.split(' ')[0]}</span>
              <button onClick={(e)=>deletarCandidato(x.id,e)} style={{background:'none',border:'none',cursor:'pointer',fontSize:'16px',color:'#dc2626',padding:'4px'}} title="Apagar">🗑</button>
            </div>
          </div>
          {exp===i && (
            <div style={{marginTop:'20px',borderTop:'1px solid #f1f5f9',paddingTop:'20px'}}>
              <p style={{color:'#475569',fontSize:'14px',marginBottom:'16px'}}>{x.avaliacao?.resumo}</p>
              {x.avaliacao?.pontos_fortes?.length>0&&<div style={{marginBottom:'12px'}}><strong style={{fontSize:'13px',color:'#16a34a'}}>✅ Pontos fortes</strong><ul style={{margin:'8px 0 0',paddingLeft:'20px'}}>{x.avaliacao.pontos_fortes.map((p,j)=><li key={j} style={{fontSize:'13px',color:'#475569'}}>{p}</li>)}</ul></div>}
              {x.avaliacao?.alertas?.length>0&&<div style={{marginBottom:'16px'}}><strong style={{fontSize:'13px',color:'#dc2626'}}>⚠️ Alertas</strong><ul style={{margin:'8px 0 0',paddingLeft:'20px'}}>{x.avaliacao.alertas.map((a,j)=><li key={j} style={{fontSize:'13px',color:'#475569'}}>{a}</li>)}</ul></div>}
              <strong style={{fontSize:'13px',color:'#475569'}}>Respostas</strong>
              {x.respostas.map((r,j)=>(
                <div key={j} style={{marginTop:'12px',background:'#f8fafc',borderRadius:'8px',padding:'12px'}}>
                  <p style={{margin:'0 0 6px',fontSize:'12px',color:'#94a3b8',fontWeight:'600'}}>P{j+1}: {PERGUNTAS[j]}</p>
                  <p style={{margin:0,fontSize:'14px',color:'#1e293b'}}>{r.texto}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const [tela, setTela] = useState("candidato")
  const apiKey = import.meta.env.VITE_ANTHROPIC_KEY || ""

  if (tela==="painel") return <Painel onVoltar={()=>setTela("candidato")} />

  return (
    <div style={{position:"relative"}}>
      <TelaCandidato apiKey={apiKey} onFinalizar={()=>setTela("candidato")} />
      <button
        onClick={()=>setTela("painel")}
        style={{position:"fixed",bottom:"16px",right:"16px",background:"#1e293b",color:"white",border:"none",borderRadius:"8px",padding:"10px 18px",fontSize:"13px",fontWeight:"600",cursor:"pointer",zIndex:100,boxShadow:"0 4px 12px rgba(0,0,0,.3)"}}>
        🔒 Painel G&C
      </button>
    </div>
  )
}
