import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  RefreshCw, 
  Search, 
  Calendar, 
  AlertTriangle, 
  FileCheck, 
  Layers,
  CheckCircle2,
  Clock,
  ArrowRight
} from 'lucide-react';

import OSPUpdateWorkflow from './maintenance/OSPUpdateWorkflow.jsx';
import AuditReadinessCheck from './maintenance/AuditReadinessCheck.jsx';
import InspectorPrep from './maintenance/InspectorPrep.jsx';
import ActionResponse from './maintenance/ActionResponse.jsx';
import NationalListReview from './maintenance/NationalListReview.jsx';
import InputVerification from './maintenance/InputVerification.jsx';

const TOOLS = [
  { id: 'osp-update', title: 'Annual OSP Update', icon: RefreshCw, color: '#1B6B2E', desc: 'Guided workflow for NOP §205.406 continuation.' },
  { id: 'audit-ready', title: 'Audit Readiness', icon: Search, color: '#002D54', desc: 'Self-audit checklist for NOP §205.103 records.' },
  { id: 'inspector-prep', title: 'Inspector Prep', icon: Calendar, color: '#FDBD10', desc: 'Walkthrough and document pull for inspection date.' },
  { id: 'adverse-action', title: 'Action Response', icon: AlertTriangle, color: '#ef4444', desc: 'Draft responses to non-compliance notices.' },
  { id: 'national-list', title: 'National List Review', icon: FileCheck, color: '#8b5cf6', desc: 'Alerts for updates to §205.601–606.' },
  { id: 'input-verify', title: 'Input Re-verification', icon: Layers, color: '#f97316', desc: 'Annual check of fertilizers, seed and pest controls.' },
];

export default function MaintenanceModule({ profile, userId, farm, onNavigate }) {
  const [activeSubTool, setActiveSubTool] = useState(null);

  if (activeSubTool) {
    return (
      <div style={{ padding: 40, background: 'var(--cream)', minHeight: 'calc(100vh - 80px)' }}>
        <button 
          onClick={() => setActiveSubTool(null)}
          style={{ marginBottom: 24, background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14 }}
        >
          &larr; Back to Maintenance Dashboard
        </button>
        <div style={{ background: 'white', borderRadius: 20, padding: 40, border: '1px solid #e2e8f0', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
            <div style={{ width: 40, height: 40, background: `${TOOLS.find(t => t.id === activeSubTool)?.color}15`, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {(() => {
                const Icon = TOOLS.find(t => t.id === activeSubTool)?.icon;
                return Icon ? <Icon size={20} color={TOOLS.find(t => t.id === activeSubTool)?.color} /> : null;
              })()}
            </div>
            <h2 style={{ fontFamily: 'Lora, serif', fontSize: 26, color: 'var(--u-navy)' }}>{TOOLS.find(t => t.id === activeSubTool)?.title}</h2>
          </div>
          
          {activeSubTool === 'osp-update' && <OSPUpdateWorkflow profile={profile} />}
          {activeSubTool === 'audit-ready' && <AuditReadinessCheck userId={userId} />}
          {activeSubTool === 'inspector-prep' && <InspectorPrep profile={profile} />}
          {activeSubTool === 'adverse-action' && <ActionResponse profile={profile} />}
          {activeSubTool === 'national-list' && <NationalListReview farm={farm} profile={profile} />}
          {activeSubTool === 'input-verify' && <InputVerification farm={farm} onNavigate={onNavigate} />}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 40 }}>
      <header style={{ marginBottom: 40 }}>
        <h1 style={{ fontFamily: 'Lora, serif', fontSize: 32, color: 'var(--u-navy)', marginBottom: 12 }}>
          Certification Maintenance
        </h1>
        <p style={{ fontSize: 16, color: '#64748b', maxWidth: 700 }}>
          Tools for currently certified producers to maintain compliance, renew their Organic System Plan, 
          and prepare for annual inspections.
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 24 }}>
        {TOOLS.map((tool) => (
          <motion.div
            key={tool.id}
            whileHover={{ y: -4, boxShadow: '0 12px 24px rgba(0,0,0,0.05)' }}
            onClick={() => setActiveSubTool(tool.id)}
            style={{
              background: 'white',
              borderRadius: 12,
              padding: 24,
              cursor: 'pointer',
              border: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              transition: 'all 0.2s'
            }}
          >
            <div style={{ 
              width: 48, height: 48, background: `${tool.color}10`, borderRadius: 10, 
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 
            }}>
              <tool.icon size={24} color={tool.color} />
            </div>
            <h3 style={{ fontFamily: 'Lora, serif', fontSize: 18, color: 'var(--u-navy)', marginBottom: 8 }}>
              {tool.title}
            </h3>
            <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.5, flex: 1, marginBottom: 20 }}>
              {tool.desc}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: tool.color, fontSize: 14, fontWeight: 600 }}>
              Open Tool <ArrowRight size={14} />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Compliance Health Snapshot */}
      <div style={{ marginTop: 48, background: 'var(--u-navy)', borderRadius: 16, padding: 32, color: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <CheckCircle2 color="var(--u-gold)" />
          <h2 style={{ fontFamily: 'Lora, serif', fontSize: 20 }}>Maintenance Health Snapshot</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 32 }}>
          <div>
            <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 4 }}>Last OSP Update</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>11 months ago</div>
            <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Clock size={12} /> Renewal due soon
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 4 }}>Input Verification</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>85% Complete</div>
            <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3, marginTop: 10 }}>
              <div style={{ width: '85%', height: '100%', background: 'var(--u-gold)', borderRadius: 3 }} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 4 }}>Next Inspection</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>Not Scheduled</div>
            <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>Enter date to sync</div>
          </div>
        </div>
      </div>
    </div>
  );
}
