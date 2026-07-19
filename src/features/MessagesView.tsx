import { FormEvent, useEffect, useRef, useState } from 'react'
import { CheckCircle2, MessageCircle, Mic, Paperclip, Send, Square, TriangleAlert } from 'lucide-react'
import { downloadSecureFile, getConversations, getMessages, markMessageRead, sendMessage } from '../lib/api'
import type { Conversation, Message, Patient, Session } from '../lib/types'
import { PageHeader } from '../components/PageHeader'

export default function MessagesView({ session, patient, notify }: { session: Session; patient: Patient; notify: (message: string) => void }) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [active, setActive] = useState<number | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [body, setBody] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [clinical, setClinical] = useState(false)
  const [attachment, setAttachment] = useState<File | null>(null)
  const [voiceNote, setVoiceNote] = useState<Blob | null>(null)
  const [recording, setRecording] = useState(false)
  const recorder = useRef<MediaRecorder | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getConversations(session.token, patient.id).then((items) => {
      if (cancelled) return
      setConversations(items)
      setActive((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id || null)
    }).finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [patient.id, session.token])

  useEffect(() => {
    if (!active) { setMessages([]); return }
    getMessages(session.token, active).then((items) => {
      setMessages(items)
      items.filter((item) => item.sender !== session.user.id && !item.read_receipts.some((receipt) => receipt.user === session.user.id))
        .forEach((item) => markMessageRead(session.token, item.id).catch(() => undefined))
    }).catch(() => notify('Messages could not be refreshed'))
  }, [active, notify, session.token, session.user.id])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!active || !body.trim()) return
    const sent = await sendMessage(session.token, active, body.trim(), urgent, clinical, attachment, voiceNote)
    setMessages((current) => [...current, sent])
    setBody(''); setUrgent(false); setAttachment(null); setVoiceNote(null)
    notify(urgent ? 'Urgent message sent and escalated' : 'Message sent')
  }

  const selected = conversations.find((item) => item.id === active)
  const toggleRecording = async () => {
    if (recording) { recorder.current?.stop(); return }
    if (!navigator.mediaDevices?.getUserMedia || !('MediaRecorder' in window)) { notify('Voice notes are not supported by this browser'); return }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const chunks: Blob[] = []
    const next = new MediaRecorder(stream)
    next.ondataavailable = (event) => chunks.push(event.data)
    next.onstop = () => { setVoiceNote(new Blob(chunks, { type: next.mimeType || 'audio/webm' })); setRecording(false); stream.getTracks().forEach((track) => track.stop()) }
    recorder.current = next; next.start(); setRecording(true)
  }
  return <><PageHeader eyebrow="CARE COLLABORATION" title="Patient conversations" description={`Secure, patient-specific messages for ${patient.full_name}.`} />
    <section className="main-card messages-layout"><aside className="conversation-list">
      {conversations.map((conversation) => <button key={conversation.id} className={active === conversation.id ? 'active' : ''} onClick={() => setActive(conversation.id)}><span className="avatar avatar-layla"><MessageCircle /></span><span><strong>{conversation.title}</strong><p>{conversation.latest_message?.body || `${conversation.kind.toLowerCase()} conversation`}</p></span><time>{conversation.latest_message ? new Date(conversation.latest_message.created_at).toLocaleDateString() : ''}</time></button>)}
      {!loading && !conversations.length && <div className="empty-care compact"><MessageCircle /><strong>No conversation yet</strong><p>An administrator can add assigned care-team or family participants.</p></div>}
    </aside><div className="chat"><header><span className="avatar avatar-doctor"><MessageCircle /></span><span><strong>{selected?.title || 'Select a conversation'}</strong><small>{selected?.kind === 'CLINICAL' ? 'Clinical care-team channel' : 'Family update channel'}</small></span></header>
      <div className="chat-body">{messages.map((message) => <div key={message.id} className={`bubble ${message.sender === session.user.id ? 'outgoing' : 'incoming'}`}>{message.urgent && <b><TriangleAlert size={14} /> URGENT</b>}{message.body}{message.attachment && <button onClick={() => downloadSecureFile(message.attachment, session.token)}>Open secure attachment</button>}{message.voice_note && <button onClick={() => downloadSecureFile(message.voice_note, session.token)}>Open voice note</button>}<time>{message.sender_name} · {new Date(message.created_at).toLocaleString()}{message.sender === session.user.id && message.read_receipts.length ? ' · Read' : ''}</time></div>)}{active && !messages.length && <div className="empty-care compact"><CheckCircle2 /><strong>Start the conversation</strong></div>}</div>
      <form className="message-compose enhanced" onSubmit={submit}><label className="checkbox"><input type="checkbox" checked={clinical} onChange={(event) => setClinical(event.target.checked)} /><span>Clinical</span></label><label className="checkbox urgent-check"><input type="checkbox" checked={urgent} onChange={(event) => setUrgent(event.target.checked)} /><span>Urgent</span></label><label className="attachment-button" title="Attach a secure file"><Paperclip /><span className="sr-only">Attach file</span><input type="file" accept="image/*,application/pdf,audio/*" onChange={(event) => setAttachment(event.target.files?.[0] || null)} /></label><button type="button" className={recording ? 'recording' : ''} onClick={toggleRecording} aria-label={recording ? 'Stop voice note' : 'Record voice note'}>{recording ? <Square /> : <Mic />}</button><input value={body} onChange={(event) => setBody(event.target.value)} disabled={!active} placeholder={attachment ? `Attached: ${attachment.name}` : voiceNote ? 'Voice note ready' : 'Write a secure message…'} /><button className="send-button" disabled={!active || (!body.trim() && !attachment && !voiceNote)} aria-label="Send message"><Send /></button></form>
    </div></section></>
}
