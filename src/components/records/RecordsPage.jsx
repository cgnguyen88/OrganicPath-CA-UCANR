import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { recordsText } from './text.js';
import * as ui from './ui.js';
import ChangeHistory from './ChangeHistory.jsx';
import NeedsReview from './NeedsReview.jsx';
import RecordLog from './RecordLog.jsx';
import RecordsOverview from './RecordsOverview.jsx';
import ReportsPage from './ReportsPage.jsx';
import SavedViewResults from './SavedViewResults.jsx';

/**
 * Renders whichever farm-records screen the route names. Without a farm (sign-up
 * provisioning not finished, or the database not set up) it explains and offers a retry
 * instead of failing silently.
 */
export default function RecordsPage({ route, farm, role, userId, operation, savedViews = [], metaReady = true, needsReviewCount = 0, onNavigate, onChanged, onRetryFarm }) {
  const { lang } = useLanguage();
  const tt = recordsText(lang);

  if (!farm) {
    return (
      <div style={ui.page}>
        <div style={{ ...ui.card, padding: '36px 24px', textAlign: 'center' }}>
          <h1 style={{ ...ui.h1, fontSize: 20 }}>{tt.setup.title}</h1>
          <p style={{ ...ui.subtitle, margin: '0 0 18px' }}>{tt.setup.body}</p>
          <button type="button" onClick={onRetryFarm} style={ui.buttonPrimary}>{tt.setup.retry}</button>
        </div>
      </div>
    );
  }

  // The operation's details (name, owner, certifier...) come from the signed-in person's own profile, so
  // only the owner's are the farm's. For anyone else the report names the farm and nothing more.
  const reportOperation = role === 'owner' ? operation : undefined;
  const shared = { farm, role, userId, operation: reportOperation, needsReviewCount, onChanged, onNavigate };
  switch (route.type) {
    case 'review':
      return <NeedsReview {...shared} />;
    case 'log':
      return <RecordLog key={route.kind} kind={route.kind} {...shared} />;
    case 'history':
      return <ChangeHistory farm={farm} />;
    case 'reports':
      return <ReportsPage farm={farm} operation={reportOperation} needsReviewCount={needsReviewCount} />;
    case 'view': {
      const view = savedViews.find((v) => v.id === route.viewId);
      if (view) return <SavedViewResults key={view.id} view={view} {...shared} />;
      if (!metaReady) return null; // the farm's views are still loading: not "missing" yet
      return <div style={ui.page}><div style={{ ...ui.card, padding: 32, textAlign: 'center', color: '#94a3b8' }}>{tt.views.notFound}</div></div>;
    }
    default:
      return <RecordsOverview farm={farm} role={role} savedViews={savedViews} needsReviewCount={needsReviewCount} onNavigate={onNavigate} onChanged={onChanged} />;
  }
}
