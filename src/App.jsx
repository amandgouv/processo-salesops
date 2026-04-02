import { useState, useRef, useEffect } from 'react'
import { db } from './firebase'
import { collection, addDoc, getDocs, orderBy, query, doc, deleteDoc, updateDoc } from 'firebase/firestore'

const PERGUNTAS = [
  "Quais ferramentas de dados e BI você mais usa no dia a dia? Me conta como você as utiliza no trabalho.",
  "Me dá um exemplo de uma análise que você fez e que ajudou alguém a tomar uma decisão importante.",
  "Você já acompanhou metas ou ajudou a estruturar incentivos para times de vendas ou CS? Como foi?",
  "Como você usa IA no seu dia a dia — tanto no trabalho quanto na vida pessoal?"
]

const SENHA_PAINEL = "@Waid2626"
const VAGA_TITULO = "Sales Operations"

async function avaliarRespostas(apiKey, nome, respostas) {
  const prompt = `Você é um recrutador sênior da Curseduca avaliando candidatos para a vaga de ${VAGA_TITULO}. Seu papel é ser criterioso — a maioria dos candidatos NÃO deve passar nessa triagem.

Candidato: "${nome}"

${respostas.map((r, i) => `Pergunta ${i + 1}: ${PERGUNTAS[i]}\nResposta: ${r.texto || '[sem resposta]'}\n`).join('\n')}

Critérios de avaliação:
1. Domínio de dados e BI: usa ferramentas com profundidade real (SQL, Python, Looker, Power BI, etc.) — não só "conheço o Excel".
2. Capacidade analítica: transforma dados em decisão, não apenas em relatório. Mostra raciocínio de causa e efeito.
3. Experiência com metas e incentivos: já estruturou ou acompanhou comissões, OKRs, metas de vendas/CS com critério — não só "acompanhei os números".
4. Uso de IA: usa IA de forma produtiva e concreta no trabalho — não só "uso o ChatGPT às vezes".
5. Fit com startup: perfil hands-on, resolve com o que tem, não espera processo pronto.

CALIBRAÇÃO DE SCORE — use estes exemplos como âncora:

Score 80+: candidato citou ferramentas com uso concreto (ex: "construí um dashboard em Looker conectado ao BigQuery pra acompanhar churn diário"), deu exemplo real de análise que mudou uma decisão, mostrou estrutura de incentivo que montou do zero. Muito raro.

Score 65-79: candidato tem experiência real e deu exemplos com resultado percebido, mesmo sem métricas exatas. Usa BI com autonomia, já mexeu com metas de alguma forma, usa IA além do básico. Faltou profundidade em 1-2 critérios mas o perfil é claramente analítico.

Score 50-64: candidato tem familiaridade com as ferramentas mas ficou no superficial ("uso Power BI pra fazer relatórios", "acompanhei as metas do time"). Não mostrou raciocínio analítico real ou iniciativa de estruturação.

Score abaixo de 50: respostas genéricas sem nenhum caso concreto, ou perfil claramente operacional sem visão analítica.

IMPORTANTE: a maioria dos candidatos reais cai entre 50 e 72. Reserve abaixo de 50 somente para quem claramente não tem perfil. Reserve acima de 75 somente para quem claramente se destacou.

CLASSIFICAÇÃO:
- ✅ Avança: score ≥ 72 E demonstrou pelo menos 3 dos 5 critérios com substância real.
- 🟡 Talvez: score entre 55-71, ou score ≥ 72 mas com gap importante em critério essencial.
- ❌ Não avança: score < 55, ou respostas predominantemente genéricas sem nenhum exemplo real.

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

// ─── TELA CANDIDATO ──────────────────────────────────────────────────────────

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
    if (!SR) { alert("Seu navegador não suporta gravação de voz. Por favor, use o Google Chrome no computador."); return }
    try { await navigator.mediaDevices.getUserMedia({ audio: true }) }
    catch { alert("Permissão de microfone negada. Por favor, clique no ícone de cadeado na barra do navegador e permita o acesso ao microfone."); return }
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
      if (e.error === 'not-allowed') alert("Microfone bloqueado.")
      else if (e.error === 'network') alert("Erro de rede.")
      else if (e.error !== 'aborted' && e.error !== 'no-speech') alert("Erro ao gravar: " + e.error)
    }
    r.onend = () => { setGravando(false); setTexto(textoRef.current); setTextoFinalizado(textoRef.current); setEditando(true) }
    try { recRef.current = r; r.start(); setGravando(true) }
    catch (err) { alert("Não foi possível iniciar a gravação: " + err.message) }
  }

  const pararGravacao = () => {
    setGravando(false)
    if (recRef.current) { try { recRef.current.stop() } catch {}; recRef.current = null }
    setTexto(textoRef.current); setTextoFinalizado(textoRef.current); setEditando(true)
  }

  const proximaPergunta = async () => {
    const textoFinal = texto.trim()
    if (!textoFinal) return
    if (gravando) pararGravacao()
    setTexto(""); setTextoFinalizado("")
    const novas = [...respostas, { texto: textoFinal }]
    setRespostas(novas)
    if (pergAtual + 1 < PERGUNTAS.length) {
      setPergAtual(pergAtual + 1)
    } else {
      setAvaliando(true)
      const aval = await avaliarRespostas(apiKey, nome, novas)
      await addDoc(collection(db, "candidatos"), {
        nome, respostas: novas, avaliacao: aval,
        etapa: 'triagem',
        data: new Date().toLocaleDateString("pt-BR"), timestamp: new Date()
      })
      setAvaliando(false); setConcluido(true); onFinalizar()
    }
  }

  const s = {
    page: { minHeight: '100vh', background: 'linear-gradient(135deg,#0f172a,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: 'system-ui,sans-serif' },
    box: { background: 'white', borderRadius: '16px', padding: '40px', maxWidth: '600px', width: '100%', boxShadow: '0 25px 50px rgba(0,0,0,.3)' },
    btn: { background: '#7c3aed', color: 'white', border: 'none', borderRadius: '10px', padding: '14px', fontSize: '16px', fontWeight: '600', cursor: 'pointer', width: '100%', marginTop: '16px' },
    btnR: { background: '#dc2626', color: 'white', border: 'none', borderRadius: '10px', padding: '12px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
    btnG: { background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', padding: '12px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
    inp: { width: '100%', padding: '12px 16px', border: '2px solid #e2e8f0', borderRadius: '10px', fontSize: '16px', boxSizing: 'border-box', outline: 'none' },
    bar: { background: '#e2e8f0', borderRadius: '99px', height: '8px', margin: '0 0 32px' },
    barIn: (p) => ({ background: '#7c3aed', borderRadius: '99px', height: '8px', width: `${p}%`, transition: 'width .4s' }),
    qbox: { background: '#f8fafc', borderRadius: '12px', padding: '20px', margin: '0 0 24px', borderLeft: '4px solid #7c3aed' },
    badge: { display: 'inline-block', background: '#ede9fe', color: '#7c3aed', borderRadius: '99px', padding: '4px 12px', fontSize: '12px', fontWeight: '600', margin: '0 0 16px' },
    row: { display: 'flex', gap: '12px', marginTop: '16px', alignItems: 'center' },
    aviso: { background: '#f0fdf4', borderRadius: '12px', padding: '16px 20px', marginBottom: '24px', borderLeft: '4px solid #16a34a' }
  }

  if (concluido) return (
    <div style={s.page}><div style={{ ...s.box, textAlign: 'center' }}>
      <div style={{ fontSize: '64px', marginBottom: '16px' }}>✅</div>
      <h2 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a' }}>Triagem concluída!</h2>
      <p style={{ color: '#64748b', marginTop: '8px' }}>Obrigado, {nome}! Nossa equipe entrará em contato em breve.</p>
    </div></div>
  )

  if (avaliando) return (
    <div style={s.page}><div style={{ ...s.box, textAlign: 'center' }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
      <h2 style={{ fontSize: '22px', fontWeight: '700' }}>Analisando respostas...</h2>
    </div></div>
  )

  if (!iniciado) return (
    <div style={s.page}>
      <div style={s.box}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>👋</div>
          <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#0f172a', margin: '0 0 8px' }}>{VAGA_TITULO}</h1>
          <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Curseduca • Processo Seletivo</p>
        </div>
        <div style={s.aviso}>
          <p style={{ margin: '0 0 8px', fontSize: '14px', color: '#15803d', lineHeight: '1.7' }}>Olá! Antes de começar, queremos ser transparentes: essa é uma etapa experimental do nosso processo seletivo.</p>
          <p style={{ margin: '0 0 8px', fontSize: '14px', color: '#15803d', lineHeight: '1.7' }}>Estamos testando novas formas de tornar a triagem mais ágil, utilizando ferramentas de inovação, e a sua participação é fundamental pra isso.</p>
          <p style={{ margin: 0, fontSize: '14px', color: '#15803d', lineHeight: '1.7' }}>Responda com calma e naturalidade. Obrigado por fazer parte dessa inovação com a gente! 🙌</p>
        </div>
        <p style={{ color: '#475569', marginBottom: '24px', lineHeight: '1.6' }}>Você vai responder <strong>{PERGUNTAS.length} perguntas</strong> por áudio. Use o <strong>Google Chrome</strong> no computador para melhor experiência.</p>
        <input style={s.inp} placeholder="Seu nome completo" value={nome} onChange={e => setNome(e.target.value)} onKeyDown={e => e.key === 'Enter' && nome.trim() && setIniciado(true)} />
        <button style={{ ...s.btn, opacity: nome.trim() ? 1 : .5 }} onClick={() => nome.trim() && setIniciado(true)}>Começar →</button>
      </div>
    </div>
  )

  return (
    <div style={s.page}>
      <div style={s.box}>
        <span style={s.badge}>Pergunta {pergAtual + 1} de {PERGUNTAS.length}</span>
        <div style={s.bar}><div style={s.barIn((pergAtual / PERGUNTAS.length) * 100)} /></div>
        <div style={s.qbox}><p style={{ margin: 0, fontSize: '17px', fontWeight: '600', color: '#1e293b', lineHeight: '1.5' }}>{PERGUNTAS[pergAtual]}</p></div>
        {gravando ? (
          <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '16px', minHeight: '100px', marginBottom: '8px', fontSize: '15px', color: texto.trim() ? '#1e293b' : '#94a3b8', lineHeight: '1.6', border: '2px solid #dc2626' }}>
            {texto.trim() || 'A transcrição vai aparecer aqui enquanto você fala...'}
          </div>
        ) : (
          <textarea
            style={{ width: '100%', padding: '14px 16px', border: '2px solid', borderColor: editando ? '#7c3aed' : '#e2e8f0', borderRadius: '10px', fontSize: '15px', boxSizing: 'border-box', minHeight: '120px', resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: '1.6', background: '#f8fafc', marginBottom: '8px' }}
            placeholder="A transcrição vai aparecer aqui enquanto você fala..."
            value={texto}
            onChange={e => { setTexto(e.target.value); textoRef.current = e.target.value; setTextoFinalizado(e.target.value) }}
          />
        )}
        {gravando && <p style={{ color: '#dc2626', fontSize: '13px', margin: '0 0 12px' }}>🔴 Gravando... clique "Parar" quando terminar.</p>}
        {!gravando && editando && <p style={{ color: '#7c3aed', fontSize: '13px', margin: '0 0 12px' }}>✏️ Corrija o texto se precisar, depois avance.</p>}
        {!gravando && !editando && texto.trim() && <p style={{ color: '#64748b', fontSize: '13px', margin: '0 0 12px' }}>✅ Gravação finalizada.</p>}
        <div style={s.row}>
          {!gravando ? (
            <button style={s.btnG} onClick={iniciarGravacao}>{texto.trim() ? '🎙 Gravar mais' : '🎙 Gravar resposta'}</button>
          ) : (
            <button style={s.btnR} onClick={pararGravacao}>⏹ Parar</button>
          )}
          <button style={{ ...s.btn, marginTop: 0, flex: 1, opacity: texto.trim() && !gravando ? 1 : .4 }} onClick={proximaPergunta} disabled={!texto.trim() || gravando}>
            {pergAtual + 1 < PERGUNTAS.length ? 'Próxima →' : 'Enviar ✓'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── PAINEL ──────────────────────────────────────────────────────────────────

function Painel({ onVoltar, apiKey }) {
  const [senha, setSenha] = useState("")
  const [auth, setAuth] = useState(false)
  const [candidatos, setCandidatos] = useState([])
  const [exp, setExp] = useState(null)
  const [filtroStatus, setFiltroStatus] = useState("todos")
  const [abaAtiva, setAbaAtiva] = useState("triagem") // 'triagem' | 'aprovados' | 'reprovados'
  const [carregando, setCarregando] = useState(false)
  const [reavaliando, setReavaliando] = useState(null)
  const [passando, setPassando] = useState(null)
  const [reprovando, setReprovando] = useState(null)

  const carregarCandidatos = async () => {
    setCarregando(true)
    try {
      const q = query(collection(db, "candidatos"), orderBy("timestamp", "desc"))
      const snap = await getDocs(q)
      setCandidatos(snap.docs.map(d => ({ id: d.id, colecao: "candidatos", ...d.data() })))
    } catch (e) { alert("Erro ao carregar: " + e.message) }
    setCarregando(false)
  }

  const reavaliar = async (c, e) => {
    e.stopPropagation()
    if (!c.respostas) return
    setReavaliando(c.id)
    try {
      const novaAval = await avaliarRespostas(apiKey, c.nome, c.respostas)
      await updateDoc(doc(db, c.colecao, c.id), { avaliacao: novaAval })
      setCandidatos(prev => prev.map(x => x.id === c.id ? { ...x, avaliacao: novaAval } : x))
    } catch (err) { alert("Erro ao reavaliar: " + err.message) }
    setReavaliando(null)
  }

  const passarProximaEtapa = async (c, e) => {
    e.stopPropagation()
    if (!confirm(`Passar ${c.nome} para a próxima etapa?`)) return
    setPassando(c.id)
    try {
      await updateDoc(doc(db, c.colecao, c.id), { etapa: 'aprovado', dataAprovacao: new Date().toLocaleDateString("pt-BR") })
      setCandidatos(prev => prev.map(x => x.id === c.id ? { ...x, etapa: 'aprovado', dataAprovacao: new Date().toLocaleDateString("pt-BR") } : x))
      setExp(null)
    } catch (err) { alert("Erro: " + err.message) }
    setPassando(null)
  }

  const reprovar = async (c, e) => {
    e.stopPropagation()
    if (!confirm(`Reprovar ${c.nome}? Ele(a) vai para a aba Reprovados.`)) return
    setReprovando(c.id)
    try {
      await updateDoc(doc(db, c.colecao, c.id), { etapa: 'reprovado', dataReprovacao: new Date().toLocaleDateString("pt-BR") })
      setCandidatos(prev => prev.map(x => x.id === c.id ? { ...x, etapa: 'reprovado', dataReprovacao: new Date().toLocaleDateString("pt-BR") } : x))
      setExp(null)
    } catch (err) { alert("Erro: " + err.message) }
    setReprovando(null)
  }

  const voltarParaTriagem = async (c, e) => {
    e.stopPropagation()
    try {
      await updateDoc(doc(db, c.colecao, c.id), { etapa: 'triagem' })
      setCandidatos(prev => prev.map(x => x.id === c.id ? { ...x, etapa: 'triagem' } : x))
      setExp(null)
    } catch (err) { alert("Erro: " + err.message) }
  }

  const deletar = async (c, e) => {
    e.stopPropagation()
    if (!confirm(`Apagar ${c.nome}?`)) return
    try {
      await deleteDoc(doc(db, c.colecao, c.id))
      setCandidatos(prev => prev.filter(x => x.id !== c.id))
    } catch (e) { alert("Erro: " + e.message) }
  }

  useEffect(() => { if (auth) carregarCandidatos() }, [auth])

  const expandir = (i) => setExp(exp === i ? null : i)

  const sP = {
    page: { minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui,sans-serif', padding: '32px 20px' },
    card: { background: 'white', borderRadius: '12px', padding: '20px', maxWidth: '900px', margin: '0 auto 16px', boxShadow: '0 1px 3px rgba(0,0,0,.1)', cursor: 'pointer' },
    btn: { background: '#7c3aed', color: 'white', border: 'none', borderRadius: '8px', padding: '10px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
    btnVerde: { background: '#16a34a', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
    btnVermelho: { background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
    btnCinza: { background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
    btnRoxo: { background: '#ede9fe', color: '#7c3aed', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
    out: { background: 'white', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 20px', fontSize: '14px', cursor: 'pointer' },
    inp: { width: '100%', padding: '12px 16px', border: '2px solid #e2e8f0', borderRadius: '10px', fontSize: '16px', boxSizing: 'border-box', outline: 'none', marginBottom: '16px' },
    sc: (n) => ({ display: 'inline-block', background: n >= 70 ? '#dcfce7' : n >= 50 ? '#fef9c3' : '#fee2e2', color: n >= 70 ? '#16a34a' : n >= 50 ? '#ca8a04' : '#dc2626', borderRadius: '99px', padding: '4px 14px', fontSize: '13px', fontWeight: '700' }),
    abaBotao: (ativa) => ({ background: ativa ? '#7c3aed' : 'white', color: ativa ? 'white' : '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' })
  }

  if (!auth) return (
    <div style={{ ...sP.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'white', borderRadius: '16px', padding: '40px', maxWidth: '400px', width: '100%', boxShadow: '0 10px 30px rgba(0,0,0,.1)' }}>
        <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px' }}>Painel G&C</h2>
        <p style={{ color: '#64748b', marginBottom: '24px', fontSize: '14px' }}>Acesso restrito à equipe Curseduca</p>
        <input style={sP.inp} type="password" placeholder="Senha" value={senha} onChange={e => setSenha(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && senha === SENHA_PAINEL) setAuth(true) }} />
        <button style={{ ...sP.btn, width: '100%' }} onClick={() => { if (senha === SENHA_PAINEL) setAuth(true); else alert("Senha incorreta") }}>Entrar</button>
        <button style={{ ...sP.out, width: '100%', marginTop: '12px' }} onClick={onVoltar}>← Voltar</button>
      </div>
    </div>
  )

  const emTriagem = candidatos.filter(x => !x.etapa || x.etapa === 'triagem')
  const aprovados = candidatos.filter(x => x.etapa === 'aprovado')
  const reprovados = candidatos.filter(x => x.etapa === 'reprovado')

  let listaAtiva = abaAtiva === 'triagem' ? emTriagem : abaAtiva === 'aprovados' ? aprovados : reprovados
  if (abaAtiva === 'triagem' && filtroStatus !== "todos") {
    listaAtiva = listaAtiva.filter(x => x.avaliacao?.classificacao?.includes(
      filtroStatus === "avanca" ? "Avança" : filtroStatus === "talvez" ? "Talvez" : "Não avança"
    ))
  }

  return (
    <div style={sP.page}>
      {/* Header */}
      <div style={{ maxWidth: '900px', margin: '0 auto 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a' }}>Painel G&C — {VAGA_TITULO}</h1>
          <p style={{ color: '#64748b', fontSize: '14px', marginTop: '4px' }}>{emTriagem.length} em triagem · {aprovados.length} aprovado(s) · {reprovados.length} reprovado(s)</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={sP.btn} onClick={carregarCandidatos} disabled={carregando}>{carregando ? "Carregando..." : "🔄 Atualizar"}</button>
          <button style={sP.out} onClick={onVoltar}>← Voltar</button>
        </div>
      </div>

      {/* Abas */}
      <div style={{ maxWidth: '900px', margin: '0 auto 20px', display: 'flex', gap: '8px' }}>
        <button style={sP.abaBotao(abaAtiva === 'triagem')} onClick={() => { setAbaAtiva('triagem'); setExp(null) }}>📋 Triagem ({emTriagem.length})</button>
        <button style={sP.abaBotao(abaAtiva === 'aprovados')} onClick={() => { setAbaAtiva('aprovados'); setExp(null) }}>✅ Aprovados ({aprovados.length})</button>
        <button style={sP.abaBotao(abaAtiva === 'reprovados')} onClick={() => { setAbaAtiva('reprovados'); setExp(null) }}>❌ Reprovados ({reprovados.length})</button>
      </div>

      {/* Filtros — só na aba triagem */}
      {abaAtiva === 'triagem' && (
        <div style={{ maxWidth: '900px', margin: '0 auto 20px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', color: '#64748b', marginRight: '4px' }}>IA:</span>
          {[["todos", "Todos"], ["avanca", "✅ Avança"], ["talvez", "🟡 Talvez"], ["nao", "❌ Não avança"]].map(([v, l]) => (
            <button key={v} onClick={() => setFiltroStatus(v)} style={{ ...sP.btn, background: filtroStatus === v ? '#7c3aed' : 'white', color: filtroStatus === v ? 'white' : '#475569', border: '1px solid #e2e8f0', padding: '6px 14px', fontSize: '13px' }}>{l}</button>
          ))}
        </div>
      )}

      {/* Lista */}
      {listaAtiva.length === 0 && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '40px', maxWidth: '900px', margin: '0 auto', textAlign: 'center', color: '#64748b' }}>
          {abaAtiva === 'aprovados' ? 'Nenhum candidato aprovado ainda.' : abaAtiva === 'reprovados' ? 'Nenhum candidato reprovado.' : 'Nenhum candidato nessa categoria.'}
        </div>
      )}

      {listaAtiva.map((x, i) => {
        const estaReavaliando = reavaliando === x.id
        const estaPassando = passando === x.id

        return (
          <div key={x.id} style={sP.card} onClick={() => expandir(i)}>
            {/* Linha principal */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '16px' }}>{x.nome}</strong>
                <span style={{ color: '#94a3b8', fontSize: '13px' }}>{x.data}</span>
                {x.etapa === 'aprovado' && (
                  <span style={{ background: '#dcfce7', color: '#16a34a', borderRadius: '99px', padding: '2px 10px', fontSize: '11px', fontWeight: '700' }}>
                    ✅ Aprovado {x.dataAprovacao ? `em ${x.dataAprovacao}` : ''}
                  </span>
                )}
                {x.etapa === 'reprovado' && (
                  <span style={{ background: '#fee2e2', color: '#dc2626', borderRadius: '99px', padding: '2px 10px', fontSize: '11px', fontWeight: '700' }}>
                    ❌ Reprovado {x.dataReprovacao ? `em ${x.dataReprovacao}` : ''}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <span style={sP.sc(x.avaliacao?.score ?? 0)}>{x.avaliacao?.score != null ? `${x.avaliacao.score}/100` : '?'}</span>
                <span style={{ fontSize: '18px' }}>{x.avaliacao?.classificacao?.split(' ')[0]}</span>
                <button onClick={(e) => deletar(x, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#dc2626', padding: '4px' }} title="Apagar">🗑</button>
              </div>
            </div>

            {/* Expandido */}
            {exp === i && (
              <div style={{ marginTop: '20px', borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>
                {/* Botões de ação */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                  <button style={{ ...sP.btnRoxo, opacity: estaReavaliando ? 0.6 : 1 }} onClick={(e) => reavaliar(x, e)} disabled={estaReavaliando}>
                    {estaReavaliando ? '⏳ Reavaliando...' : '🤖 Reavaliar com IA'}
                  </button>

                  {x.etapa !== 'aprovado' && x.etapa !== 'reprovado' && (<>
                    <button style={{ ...sP.btnVerde, opacity: estaPassando ? 0.6 : 1 }} onClick={(e) => passarProximaEtapa(x, e)} disabled={estaPassando}>
                      {estaPassando ? '⏳ Salvando...' : '✅ Passar pra próxima etapa'}
                    </button>
                    <button style={{ ...sP.btnVermelho, opacity: reprovando === x.id ? 0.6 : 1 }} onClick={(e) => reprovar(x, e)} disabled={reprovando === x.id}>
                      {reprovando === x.id ? '⏳ Salvando...' : '❌ Reprovar'}
                    </button>
                  </>)}

                  {(x.etapa === 'aprovado' || x.etapa === 'reprovado') && (
                    <button style={sP.btnCinza} onClick={(e) => voltarParaTriagem(x, e)}>↩ Voltar pra triagem</button>
                  )}
                </div>

                {/* Avaliação IA */}
                <p style={{ color: '#475569', fontSize: '14px', marginBottom: '12px', fontStyle: 'italic' }}>{x.avaliacao?.resumo}</p>
                {x.avaliacao?.pontos_fortes?.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    <strong style={{ fontSize: '13px', color: '#16a34a' }}>✅ Pontos fortes</strong>
                    <ul style={{ margin: '8px 0 0', paddingLeft: '20px' }}>{x.avaliacao.pontos_fortes.map((p, j) => <li key={j} style={{ fontSize: '13px', color: '#475569' }}>{p}</li>)}</ul>
                  </div>
                )}
                {x.avaliacao?.alertas?.length > 0 && (
                  <div style={{ marginBottom: '16px' }}>
                    <strong style={{ fontSize: '13px', color: '#dc2626' }}>⚠️ Alertas</strong>
                    <ul style={{ margin: '8px 0 0', paddingLeft: '20px' }}>{x.avaliacao.alertas.map((a, j) => <li key={j} style={{ fontSize: '13px', color: '#475569' }}>{a}</li>)}</ul>
                  </div>
                )}

                {/* Respostas */}
                <strong style={{ fontSize: '13px', color: '#475569' }}>Respostas</strong>
                {x.respostas?.map((r, j) => (
                  <div key={j} style={{ marginTop: '12px', background: '#f8fafc', borderRadius: '8px', padding: '12px' }}>
                    <p style={{ margin: '0 0 6px', fontSize: '12px', color: '#94a3b8', fontWeight: '600' }}>P{j + 1}: {PERGUNTAS[j]}</p>
                    <p style={{ margin: 0, fontSize: '14px', color: '#1e293b', lineHeight: '1.6' }}>{r.texto}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── APP ROOT ────────────────────────────────────────────────────────────────

export default function App() {
  const [tela, setTela] = useState("candidato")
  const apiKey = import.meta.env.VITE_ANTHROPIC_KEY || ""

  if (tela === "painel") return <Painel onVoltar={() => setTela("candidato")} apiKey={apiKey} />

  return (
    <div style={{ position: "relative" }}>
      <TelaCandidato apiKey={apiKey} onFinalizar={() => setTela("candidato")} />
      <button onClick={() => setTela("painel")} style={{ position: "fixed", bottom: "16px", right: "16px", background: "#1e293b", color: "white", border: "none", borderRadius: "8px", padding: "10px 18px", fontSize: "13px", fontWeight: "600", cursor: "pointer", zIndex: 100, boxShadow: "0 4px 12px rgba(0,0,0,.3)" }}>🔒 Painel G&C</button>
    </div>
  )
}
