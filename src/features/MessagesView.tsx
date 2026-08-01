import { FormEvent, useEffect, useRef, useState } from 'react'
import { AtSign, CheckCircle2, ChevronDown, MessageCircle, Mic, Paperclip, Pencil, Plus, Send, Square, TriangleAlert, X } from 'lucide-react'
import { createConversation, downloadSecureFile, editMessage, getCareAssignments, getConversations, getMessages, markMessageRead, sendMessage, updateConversation } from '../lib/api'
import type { ApiUser, Conversation, Message, Patient, Session } from '../lib/types'
import { PageHeader } from '../components/PageHeader'
import { useDialogFocus } from '../components/useDialogFocus'

export default function MessagesView({ session, patient, notify, locale }: { session: Session; patient: Patient; notify: (message: string) => void; locale: string }) {
  const fa = locale === 'fa'
  const t = fa ? { eyebrow: 'همکاری مراقبتی', title: 'گفت‌وگوهای بیمار', description: `پیام‌های امن و اختصاصی برای ${patient.full_name}.`, newConversation: 'گفت‌وگوی جدید', noConversation: 'هنوز گفت‌وگویی وجود ندارد', noConversationText: 'مدیر می‌تواند اعضای تیم مراقبت یا خانواده را اضافه کند.', select: 'یک گفت‌وگو را انتخاب کنید', clinicalChannel: 'کانال بالینی تیم مراقبت', familyChannel: 'کانال اطلاع‌رسانی خانواده', urgent: 'فوری', save: 'ذخیره ویرایش', cancel: 'انصراف', attachment: 'باز کردن پیوست امن', voice: 'باز کردن پیام صوتی', read: 'خوانده شد', edit: 'ویرایش', start: 'گفت‌وگو را آغاز کنید', clinical: 'بالینی', mentions: 'اشاره به افراد', selected: 'انتخاب‌شده', attach: 'پیوست فایل', stop: 'توقف پیام صوتی', record: 'ضبط پیام صوتی', attached: 'پیوست شده', voiceReady: 'پیام صوتی آماده است', write: 'یک پیام امن بنویسید…', send: 'ارسال پیام', refreshError: 'پیام‌ها تازه‌سازی نشدند. دوباره تلاش کنید.', sent: 'پیام ارسال شد', urgentSent: 'پیام فوری ارسال و برای پیگیری تشدید شد', voiceUnsupported: 'مرورگر از پیام صوتی پشتیبانی نمی‌کند' } : { eyebrow: 'CARE COLLABORATION', title: 'Patient conversations', description: `Secure, patient-specific messages for ${patient.full_name}.`, newConversation: 'New conversation', noConversation: 'No conversation yet', noConversationText: 'An administrator can add assigned care-team or family participants.', select: 'Select a conversation', clinicalChannel: 'Clinical care-team channel', familyChannel: 'Family update channel', urgent: 'URGENT', save: 'Save edit', cancel: 'Cancel', attachment: 'Open secure attachment', voice: 'Open voice note', read: 'Read', edit: 'Edit', start: 'Start the conversation', clinical: 'Clinical', mentions: 'Mentions', selected: 'selected', attach: 'Attach file', stop: 'Stop voice note', record: 'Record voice note', attached: 'Attached', voiceReady: 'Voice note ready', write: 'Write a secure message…', send: 'Send message', refreshError: 'Messages could not be refreshed. Try again.', sent: 'Message sent', urgentSent: 'Urgent message sent and escalated', voiceUnsupported: 'Voice notes are not supported by this browser' }
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
  const [participants, setParticipants] = useState<ApiUser[]>([])
  const [mentions, setMentions] = useState<number[]>([])
  const [conversationEditor, setConversationEditor] = useState<Conversation | 'new' | null>(null)
  const [editingMessage, setEditingMessage] = useState<Message | null>(null)
  const [editBody, setEditBody] = useState('')

  useEffect(() => {
    let cancelled = false
    getConversations(session.token, patient.id).then((items) => {
      if (cancelled) return
      setConversations(items)
      setActive((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id || null)
    }).finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [patient.id, session.token])

  useEffect(() => { getCareAssignments(session.token, patient.id).then((items) => setParticipants(items.map((item) => item.user_detail))).catch(() => setParticipants([])) }, [patient.id, session.token])

  useEffect(() => {
    if (!active) { setMessages([]); return }
    getMessages(session.token, active).then((items) => {
      setMessages(items)
      items.filter((item) => item.sender !== session.user.id && !item.read_receipts.some((receipt) => receipt.user === session.user.id))
        .forEach((item) => markMessageRead(session.token, item.id).catch(() => undefined))
    }).catch(() => notify(t.refreshError))
  }, [active, notify, session.token, session.user.id, t.refreshError])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!active || (!body.trim() && !attachment && !voiceNote)) return
    const sent = await sendMessage(session.token, active, body.trim(), urgent, clinical, attachment, voiceNote, mentions)
    setMessages((current) => [...current, sent])
    setBody(''); setUrgent(false); setAttachment(null); setVoiceNote(null); setMentions([])
    notify(urgent ? t.urgentSent : t.sent)
  }

  const selected = conversations.find((item) => item.id === active)
  const toggleRecording = async () => {
    if (recording) { recorder.current?.stop(); return }
    if (!navigator.mediaDevices?.getUserMedia || !('MediaRecorder' in window)) { notify(t.voiceUnsupported); return }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const chunks: Blob[] = []
    const next = new MediaRecorder(stream)
    next.ondataavailable = (event) => chunks.push(event.data)
    next.onstop = () => { setVoiceNote(new Blob(chunks, { type: next.mimeType || 'audio/webm' })); setRecording(false); stream.getTracks().forEach((track) => track.stop()) }
    recorder.current = next; next.start(); setRecording(true)
  }
  const refreshConversations = async () => { const items = await getConversations(session.token, patient.id); setConversations(items); setActive((current) => current || items[0]?.id || null) }
  return <><PageHeader eyebrow={t.eyebrow} title={t.title} description={t.description} action={<button className="primary-button" onClick={() => setConversationEditor('new')}><Plus />{t.newConversation}</button>} />
    <section className="main-card messages-layout"><aside className="conversation-list">
      {conversations.map((conversation) => <button key={conversation.id} className={active === conversation.id ? 'active' : ''} onClick={() => setActive(conversation.id)}><span className="avatar avatar-layla"><MessageCircle /></span><span><strong>{conversation.title}</strong><p>{conversation.latest_message?.body || `${conversation.kind.toLowerCase()} conversation`}</p></span><time>{conversation.latest_message ? new Date(conversation.latest_message.created_at).toLocaleDateString() : ''}</time></button>)}
      {!loading && !conversations.length && <div className="empty-care compact"><MessageCircle /><strong>{t.noConversation}</strong><p>{t.noConversationText}</p></div>}
    </aside><div className="chat"><header><span className="avatar avatar-doctor"><MessageCircle /></span><span><strong>{selected?.title || t.select}</strong><small>{selected?.kind === 'CLINICAL' ? t.clinicalChannel : t.familyChannel}</small></span>{selected && <button onClick={() => setConversationEditor(selected)} aria-label={t.edit}><Pencil /></button>}</header>
      <div className="chat-body">{messages.map((message) => <div key={message.id} className={`bubble ${message.sender === session.user.id ? 'outgoing' : 'incoming'}`}>{message.urgent && <b><TriangleAlert size={14} /> {t.urgent}</b>}{editingMessage?.id === message.id ? <form onSubmit={async (event) => { event.preventDefault(); const updated = await editMessage(session.token, message.id, editBody); setMessages((current) => current.map((item) => item.id === updated.id ? updated : item)); setEditingMessage(null) }}><textarea value={editBody} onChange={(event) => setEditBody(event.target.value)} /><button className="primary-button">{t.save}</button><button type="button" onClick={() => setEditingMessage(null)}>{t.cancel}</button></form> : message.body}{message.attachment && <button onClick={() => downloadSecureFile(message.attachment, session.token)}>{t.attachment}</button>}{message.voice_note && <button onClick={() => downloadSecureFile(message.voice_note, session.token)}>{t.voice}</button>}<time>{message.sender_name} · {new Date(message.created_at).toLocaleString(fa ? 'fa-IR-u-ca-persian' : undefined)}{message.sender === session.user.id && message.read_receipts.length ? ` · ${t.read}` : ''}</time>{message.sender === session.user.id && editingMessage?.id !== message.id && <button className="text-button" onClick={() => { setEditingMessage(message); setEditBody(message.body) }}><Pencil />{t.edit}</button>}</div>)}{active && !messages.length && <div className="empty-care compact"><CheckCircle2 /><strong>{t.start}</strong></div>}</div>
      <form className="message-compose enhanced" onSubmit={submit}><label className="checkbox"><input type="checkbox" checked={clinical} onChange={(event) => setClinical(event.target.checked)} /><span>{t.clinical}</span></label><label className="checkbox urgent-check"><input type="checkbox" checked={urgent} onChange={(event) => setUrgent(event.target.checked)} /><span>{t.urgent}</span></label><details className="mentions-control"><summary><AtSign /><span>{mentions.length ? `${mentions.length} ${t.selected}` : t.mentions}</span><ChevronDown /></summary><div className="mention-options">{selected?.participant_details.filter((item) => item.id !== session.user.id).map((item) => <label key={item.id}><input type="checkbox" checked={mentions.includes(item.id)} onChange={() => setMentions((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><span><strong>@{item.display_name}</strong><small>{item.role}</small></span></label>)}</div></details><label className="attachment-button" title={t.attach}><Paperclip /><span className="sr-only">{t.attach}</span><input type="file" accept="image/*,application/pdf,audio/*" onChange={(event) => setAttachment(event.target.files?.[0] || null)} /></label><button type="button" className={recording ? 'recording' : ''} onClick={toggleRecording} aria-label={recording ? t.stop : t.record}>{recording ? <Square /> : <Mic />}</button><input value={body} onChange={(event) => setBody(event.target.value)} disabled={!active} placeholder={attachment ? `${t.attached}: ${attachment.name}` : voiceNote ? t.voiceReady : t.write} /><button className="send-button" disabled={!active || (!body.trim() && !attachment && !voiceNote)} aria-label={t.send}><Send /></button></form>
    </div></section>{conversationEditor && <ConversationEditor locale={locale} conversation={conversationEditor} patient={patient} participants={participants} token={session.token} onClose={() => setConversationEditor(null)} onSaved={async () => { setConversationEditor(null); await refreshConversations(); notify(fa ? 'گفت‌وگو و شرکت‌کنندگان ذخیره شدند' : 'Conversation and participants saved') }} />}</>
}

function ConversationEditor({ conversation, patient, participants, token, onClose, onSaved, locale }: { conversation: Conversation | 'new'; patient: Patient; participants: ApiUser[]; token: string; onClose: () => void; onSaved: () => Promise<void>; locale: string }) {
  const fa = locale === 'fa'
  const [title, setTitle] = useState(conversation === 'new' ? '' : conversation.title)
  const [kind, setKind] = useState<'CLINICAL' | 'FAMILY'>(conversation === 'new' ? 'CLINICAL' : conversation.kind)
  const [selected, setSelected] = useState<number[]>(conversation === 'new' ? [] : conversation.participant_details.map((item) => item.id))
  const dialogRef = useRef<HTMLFormElement>(null)
  useDialogFocus(dialogRef, onClose)
  const submit = async (event: FormEvent) => { event.preventDefault(); const payload = { patient: patient.id, title, kind, participants: selected, active: true }; if (conversation === 'new') await createConversation(token, payload); else await updateConversation(token, conversation.id, payload); await onSaved() }
  return <div className="modal-layer"><button className="modal-backdrop" onClick={onClose} aria-label={fa ? 'بستن ویرایشگر گفت‌وگو' : 'Close conversation editor'} tabIndex={-1} /><form ref={dialogRef} className="modal task-form" role="dialog" aria-modal="true" aria-label={fa ? 'ویرایشگر گفت‌وگو' : 'Conversation editor'} tabIndex={-1} onSubmit={submit}><button type="button" className="modal-close" onClick={onClose} aria-label={fa ? 'بستن' : 'Close'}><X /></button><h2>{conversation === 'new' ? (fa ? 'گفت‌وگوی جدید بیمار' : 'New patient conversation') : (fa ? 'مدیریت گفت‌وگو' : 'Manage conversation')}</h2><label>{fa ? 'عنوان' : 'Title'}<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>{fa ? 'دسته‌بندی' : 'Classification'}<select value={kind} onChange={(event) => setKind(event.target.value as 'CLINICAL' | 'FAMILY')}><option value="CLINICAL">{fa ? 'بالینی' : 'Clinical'}</option><option value="FAMILY">{fa ? 'خانواده' : 'Family'}</option></select></label><fieldset className="verification-list"><legend>{fa ? 'شرکت‌کنندگان' : 'Participants'}</legend>{participants.map((item) => <label className="verification-check" key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><span><strong>{item.display_name}</strong><small>{item.role}</small></span></label>)}</fieldset><button className="primary-button">{fa ? 'ذخیره گفت‌وگو' : 'Save conversation'}</button></form></div>
}
