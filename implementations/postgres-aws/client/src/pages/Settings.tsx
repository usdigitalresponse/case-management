import { useState } from 'react';
import { useLocation } from 'react-router';
import { useResource } from '../hooks/useResource';
import { professionalKinds } from '../resources';
import { useAuth } from '../AuthContext';
import { PageHeading } from '../components/PageHeading';
import { Notice } from '../components/ui/Notice';
import { DecisionReasonSettings, ReviewRoutingSettings, RoleSummary, StaffRoleSettings } from './settings/ReviewSettings';
import { PreauthorizationThresholds } from './settings/PreauthorizationThresholds';
import { AddKindForm, KindCard } from './settings/KindRates';
import { MileageRates } from './settings/MileageRates';
import { TimeCategoryRates } from './settings/TimeCategoryRates';
import { BillingRulesSettings } from './settings/BillingRulesSection';
import { DemoSettings } from './settings/DemoSection';
import { ExternalUserSettings } from './settings/ExternalUsers';
import { EditData } from './settings/EditData';
import { Tabs } from '../components/ui/Tabs';
import { useSearchParamState } from '../hooks/useSearchParamState';

export default function Settings() {
  const [version, setVersion] = useState(0);
  const { data, error } = useResource(professionalKinds, { resetKey: version });
  const refresh = () => setVersion((v) => v + 1);
  const { user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);
  const demoMode = Boolean(user?.demoMode);

  // Edit data is for administrators only (pages/settings/EditData.tsx).
  const [tab, setTab] = useSearchParamState('tab', 'settings', TABS);
  if (isAdmin && tab === 'edit-data') {
    return (
      <div>
        <PageHeading eyebrow="Administration" title="Settings" />
        <SettingsTabs tab={tab} setTab={setTab} />
        <div id="settings-tab">
          <EditData />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeading eyebrow="Administration" title="Settings" />
      {isAdmin && <SettingsTabs tab="settings" setTab={setTab} />}
      <PageIndex sections={SECTIONS.filter((section) => section.id !== 'settings-demo' || demoMode)} />
      <Notice tone="info">Only administrators can change settings. Everyone on staff can read this page.</Notice>
      <section className="settings-section" id="settings-review">
        <h2>Invoice review</h2>
        <div className="settings-columns">
          <ReviewRoutingSettings isAdmin={isAdmin} />
          <DecisionReasonSettings isAdmin={isAdmin} />
        </div>
      </section>
      <section className="settings-section" id="settings-people">
        <h2>People who use this tool</h2>
        <RoleSummary />
        {isAdmin && <StaffRoleSettings />}
      </section>
      <section className="settings-section" id="settings-external-users">
        <h2>External users</h2>
        <p className="compact-hint">
          Attorneys, providers and office billing staff outside the agency. They sign in with a code emailed to them, and only
          those turned on here can sign in.
        </p>
        <ExternalUserSettings isAdmin={isAdmin} />
      </section>
      <section className="settings-section" id="settings-rates">
        <h2>Rates</h2>
        <p className="compact-hint">
          Time is invoiced at the hourly rate for each kind of professional on the date of the work. Travel and waiting
          time use their settings below, and mileage uses the rate per mile on the date of the trip. A rate set on a
          person's page takes the place of these for that person.
        </p>
        {Boolean(error) && <Notice tone="danger">Failed to load rates.</Notice>}
        {data && data.length === 0 && <p>No kinds of professional yet.</p>}
        <div className="settings-grid">
          {data?.map((kind) => <KindCard key={kind.professionalKindId} kind={kind} isAdmin={isAdmin} onChanged={refresh} />)}
          <MileageRates isAdmin={isAdmin} />
          <TimeCategoryRates category="travel" isAdmin={isAdmin} />
          <TimeCategoryRates category="waiting" isAdmin={isAdmin} />
        </div>
        {isAdmin && <AddKindForm onAdded={refresh} />}
      </section>
      <section className="settings-section" id="settings-preauthorization">
        <h2>Pre-authorization thresholds</h2>
        <p className="compact-hint">
          Up to the threshold, a provider's work on a case needs no pre-authorization. Senders must explain going past it, or
          past what's pre-authorized; the invoice is still reviewed.
        </p>
        <PreauthorizationThresholds isAdmin={isAdmin} />
      </section>
      <BillingRulesSettings isAdmin={isAdmin} />
      {demoMode && <DemoSettings isAdmin={isAdmin} />}
    </div>
  );
}

const TABS = ['settings', 'edit-data'] as const;

function SettingsTabs({ tab, setTab }: { tab: (typeof TABS)[number]; setTab: (tab: (typeof TABS)[number]) => void }) {
  return (
    <Tabs
      label="Settings"
      controls="settings-tab"
      tabs={[
        { id: 'settings', label: 'Settings' },
        { id: 'edit-data', label: 'Edit data' },
      ]}
      selected={tab}
      onSelect={setTab}
    />
  );
}

const SECTIONS = [
  { id: 'settings-review', label: 'Invoice review' },
  { id: 'settings-people', label: 'People who use this tool' },
  { id: 'settings-external-users', label: 'External users' },
  { id: 'settings-rates', label: 'Rates' },
  { id: 'settings-preauthorization', label: 'Pre-authorization thresholds' },
  { id: 'settings-rules', label: 'Billing rules and codes' },
  { id: 'settings-demo', label: 'Demo' },
];

// Links to each section; the one last chosen is shown as current.
function PageIndex({ sections }: { sections: typeof SECTIONS }) {
  const { hash } = useLocation();
  const current = hash.slice(1) || sections[0]?.id;
  return (
    <nav className="page-index" aria-label="On this page">
      <span>On this page:</span>
      {sections.map((section) => (
        <a key={section.id} href={`#${section.id}`} className={section.id === current ? 'is-current' : undefined} aria-current={section.id === current ? 'location' : undefined}>
          {section.label}
        </a>
      ))}
    </nav>
  );
}
