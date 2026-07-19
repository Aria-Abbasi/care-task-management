import { useEffect, useState } from 'react'
import { AlertTriangle, ClipboardList, FileCheck2, FileText, Phone, ShieldAlert, Stethoscope } from 'lucide-react'
import { downloadSecureFile, getClinicalProfile } from '../lib/api'
import type { AdvanceDirective, Allergy, CarePlan, ClinicalDocument, Diagnosis, EmergencyContact, Patient, Session } from '../lib/types'
import { PageHeader } from '../components/PageHeader'

type Profile = { allergies: Allergy[]; diagnoses: Diagnosis[]; carePlans: CarePlan[]; contacts: EmergencyContact[]; directives: AdvanceDirective[]; documents: ClinicalDocument[] }
const empty: Profile = { allergies: [], diagnoses: [], carePlans: [], contacts: [], directives: [], documents: [] }

export default function ClinicalProfileView({ session, patient }: { session: Session; patient: Patient }) {
  const [profile, setProfile] = useState<Profile>(empty)
  useEffect(() => { getClinicalProfile(session.token, patient.id).then(setProfile) }, [patient.id, session.token])
  return <><PageHeader eyebrow="LONGITUDINAL RECORD" title="Clinical profile" description={`Care plans, safety records, contacts, directives, and provenance for ${patient.full_name}.`} /><div className="clinical-grid">
    <section className="main-card clinical-section"><h3><ShieldAlert /> Allergies & contraindications</h3>{profile.allergies.map((item) => <article key={item.id}><AlertTriangle /><span><strong>{item.substance}</strong><small>{item.severity} · {item.reaction || 'Reaction not documented'} · source: {item.source_system || 'Haven'}</small></span></article>)}{!profile.allergies.length && <p>No active allergies documented.</p>}</section>
    <section className="main-card clinical-section"><h3><Stethoscope /> Diagnoses</h3>{profile.diagnoses.map((item) => <article key={item.id}><Stethoscope /><span><strong>{item.display}</strong><small>{item.status}{item.code ? ` · ${item.code}` : ''} · source: {item.source_system || 'Haven'}</small></span></article>)}{!profile.diagnoses.length && <p>No diagnoses documented.</p>}</section>
    <section className="main-card clinical-section wide"><h3><ClipboardList /> Active care plans</h3>{profile.carePlans.map((item) => <article key={item.id}><ClipboardList /><span><strong>{item.title}</strong><small>{item.status} · {item.author_name}</small><p>{item.instructions}</p>{item.goals.length > 0 && <ul>{item.goals.map((goal) => <li key={goal}>{goal}</li>)}</ul>}</span></article>)}{!profile.carePlans.length && <p>No active care plan recorded.</p>}</section>
    <section className="main-card clinical-section"><h3><Phone /> Emergency & family contacts</h3>{profile.contacts.map((item) => <article key={item.id}><Phone /><span><strong>{item.name}</strong><small>{item.relationship} · {item.phone}</small>{item.authorized_for_updates && <b>Authorized for updates</b>}</span></article>)}{!profile.contacts.length && <p>No emergency contacts documented.</p>}</section>
    <section className="main-card clinical-section"><h3><FileCheck2 /> Advance directives</h3>{profile.directives.map((item) => <article key={item.id}><FileCheck2 /><span><strong>{item.directive_type}</strong><small>{item.effective_from || 'Effective date not recorded'}</small><p>{item.summary}</p></span></article>)}{!profile.directives.length && <p>No advance directive documented.</p>}</section>
    <section className="main-card clinical-section wide"><h3><FileText /> Secure documents</h3>{profile.documents.map((item) => <button className="secure-document" onClick={() => downloadSecureFile(item.file, session.token)} key={item.id}><FileText /><span><strong>{item.title}</strong><small>{item.category} · source: {item.source_system || 'Haven'} · retained until {item.retention_until || 'policy review'}</small></span></button>)}{!profile.documents.length && <p>No secure documents uploaded.</p>}</section>
  </div></>
}
