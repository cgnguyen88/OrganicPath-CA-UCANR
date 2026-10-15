import { useState, useEffect, useRef } from 'react';
import { supabase } from './lib/supabase.js';
import { getProfile, upsertProfile, ensureMyFarm, getFarm } from './lib/db.js';
import { saveToStorage, loadFromStorage } from './utils/storage.js';
import AuthScreen from './components/AuthScreen.jsx';
import AppShell from './components/AppShell.jsx';
import Dashboard from './components/Dashboard.jsx';
import EligibilityChecker from './components/EligibilityChecker.jsx';
import ComplianceTracker from './components/ComplianceTracker.jsx';
import OSPGenerator from './components/OSPGenerator.jsx';
import ExpandableChat from './components/ExpandableChat.jsx';
import RecordGenerators from './components/RecordGenerators.jsx';
import CertifierDirectory from './components/CertifierDirectory.jsx';
import SoilLabDirectory from './components/SoilLabDirectory.jsx';
import StateRegistration from './components/StateRegistration.jsx';
import OCCSPAssistant from './components/OCCSPAssistant.jsx';
import CertificationStatusGate from './components/CertificationStatusGate.jsx';
import MaintenanceModule from './components/MaintenanceModule.jsx';
import OMRIGuide from './components/OMRIGuide.jsx';
import FoodSafetyGuide from './components/FoodSafetyGuide.jsx';
import FederalCodeGuide from './components/FederalCodeGuide.jsx';
import RecordsPage from './components/records/RecordsPage.jsx';
import useRecordsMeta from './components/records/useRecordsMeta.js';
import { parseRecordsRoute } from './lib/recordsRoute.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [activePage, setActivePage] = useState('dashboard');
  const [profile, setProfile] = useState({});
  const [farm, setFarm] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  // True when a brand-new signup just completed — always show the gate
  const [forceGate, setForceGate] = useState(false);

  // Every account belongs to a farm; this also repairs accounts whose sign-up
  // provisioning was missed. Idempotent.
  const farmRequest = useRef(0);
  const loadFarm = async () => {
    const ticket = ++farmRequest.current;
    const farmId = await ensureMyFarm();
    const nextFarm = await getFarm(farmId);
    // A newer lookup, or a sign-out, happened while this one was in flight: drop the stale result.
    if (ticket === farmRequest.current) setFarm(nextFarm);
  };

  const recordsMeta = useRecordsMeta({ farm, userId: user?.id });

  // On mount: restore session from Supabase
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const u = session.user;
        const name = u.user_metadata?.name || u.email.split('@')[0];
        setUser({ id: u.id, name, email: u.email });
        loadUserProfile(u.id);
        loadFarm();
      }
      setAuthLoading(false);
    });

    // Listen for auth changes (login/logout/token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const u = session.user;
        const name = u.user_metadata?.name || u.email.split('@')[0];
        setUser({ id: u.id, name, email: u.email });
        loadUserProfile(u.id);
        loadFarm();
      } else {
        setUser(null);
        setProfile({});
        farmRequest.current += 1;
        setFarm(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadUserProfile = async (userId) => {
    // Load from localStorage cache first (fast)
    const cached = loadFromStorage(`orgpath_profile_${userId}`, null);
    if (cached) setProfile(cached);

    // Then fetch from Supabase and merge
    const dbProfile = await getProfile(userId);
    if (dbProfile?.operation_data) {
      const merged = { ...(cached || {}), ...dbProfile.operation_data };
      setProfile(merged);
      saveToStorage(`orgpath_profile_${userId}`, merged);
    }
  };

  const handleLogin = (u) => {
    setUser(u);
    if (u.isNew) setForceGate(true);
    if (u.id) loadUserProfile(u.id);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile({});
    farmRequest.current += 1;
    setFarm(null);
  };

  const updateProfile = (data) => {
    const next = { ...profile, ...data };
    setProfile(next);
    if (user?.id) {
      saveToStorage(`orgpath_profile_${user.id}`, next);
      upsertProfile(user.id, { operation_data: next });
    }
  };

  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--cream)' }}>
        <div style={{ textAlign: 'center', color: 'var(--u-navy)' }}>
          <div style={{ width: 40, height: 40, border: '3px solid var(--u-navy)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, opacity: 0.7 }}>Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return <AuthScreen onLogin={handleLogin} />;

  const handleStatusSelect = (status) => {
    setForceGate(false);
    updateProfile({ certificationStatus: status });
    if (status === 'certified') {
      setActivePage('maintenance');
    } else {
      setActivePage('dashboard');
    }
  };

  if (forceGate || !profile.certificationStatus) {
    return <CertificationStatusGate onSelect={handleStatusSelect} />;
  }

  const sidebar = {
    user,
    farm,
    needsReviewCount: recordsMeta.needsReviewCount,
    savedViews: recordsMeta.savedViews,
    onLogout: handleLogout,
    certificationStatus: profile.certificationStatus,
    onChangeStatus: () => setForceGate(true),
    onSetStatus: (status) => {
      updateProfile({ certificationStatus: status });
      setActivePage(status === 'certified' ? 'maintenance' : 'dashboard');
    },
  };

  return (
    <>
      <AppShell activePage={activePage} onNavigate={setActivePage} sidebar={sidebar}>
        {activePage === 'dashboard' && <Dashboard user={user} onNavigate={setActivePage} profile={profile} />}
        {activePage === 'maintenance' && <MaintenanceModule profile={profile} userId={user?.id} farm={farm} onNavigate={setActivePage} />}
        {activePage === 'eligibility' && <EligibilityChecker onNavigate={setActivePage} onUpdateProfile={updateProfile} />}
        {activePage === 'tracker' && <ComplianceTracker userId={user?.id} certificationStatus={profile.certificationStatus} />}
        {activePage === 'osp' && <OSPGenerator profile={profile} onUpdateProfile={updateProfile} onNavigate={setActivePage} userId={user?.id} />}
        {activePage === 'recordGenerators' && <RecordGenerators profile={profile} farm={farm} onNavigate={setActivePage} />}
        {parseRecordsRoute(activePage) && (
          <RecordsPage
            route={parseRecordsRoute(activePage)}
            farm={farm}
            role={recordsMeta.role}
            userId={user?.id}
            operation={profile}
            savedViews={recordsMeta.savedViews}
            metaReady={recordsMeta.ready}
            needsReviewCount={recordsMeta.needsReviewCount}
            onNavigate={setActivePage}
            onChanged={recordsMeta.refresh}
            onRetryFarm={loadFarm}
          />
        )}
        {activePage === 'certifiers' && <CertifierDirectory />}
        {activePage === 'soilLabs' && <SoilLabDirectory />}
        {activePage === 'stateReg' && <StateRegistration userId={user?.id} />}
        {activePage === 'occsp' && <OCCSPAssistant profile={profile} userId={user?.id} />}
        {activePage === 'omriGuide' && <OMRIGuide />}
        {activePage === 'foodSafety' && <FoodSafetyGuide />}
        {activePage === 'federalCode' && <FederalCodeGuide />}
      </AppShell>

      <ExpandableChat profile={profile} />
    </>
  );
}
