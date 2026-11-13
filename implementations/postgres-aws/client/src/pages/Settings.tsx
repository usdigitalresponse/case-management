// Settings, one section at a time behind a row of tabs (design K51, K67), so
// each section loads only when it is chosen; the tab is in the address.
import { useEffect, useState } from 'react';
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
import { ProvidersSettings } from './settings/ProvidersSettings';
import { MergeDuplicates } from '../components/MergeDuplicates';
import { EditData } from './settings/EditData';
import { Tabs } from '../components/ui/Tabs';
import { useSearchParamState } from '../hooks/useSearchParamState';
import { SETTINGS_TABS, type SettingsTab } from '../staffPaths';

const LABELS: Record<SettingsTab, string> = {
  review: 'Invoice review',
  people: 'People who use this tool',
  rates: 'Rates',
  preauthorization: 'Pre-authorization thresholds',
  rules: 'Billing rules and codes',
  providers: 'Providers',
  'office-staff': 'Office billing staff',
  duplicates: 'Merge duplicates',
  'edit-data': 'Edit data',
  demo: 'Demo',
};

// Links from before the tabs named a section by its anchor.
const OLD_ANCHORS: Record<string, SettingsTab> = {
  'settings-review': 'review',
  'settings-people': 'people',
  'settings-rates': 'rates',
  'settings-preauthorization': 'preauthorization',
  'settings-rules': 'rules',
  'settings-providers': 'providers',
  'settings-external-users': 'office-staff',
  'settings-duplicates': 'duplicates',
  'settings-demo': 'demo',
};

export default function Settings() {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);
  const demoMode = Boolean(user?.demoMode);
  const shown = SETTINGS_TABS.filter((id) => (id !== 'edit-data' || isAdmin) && (id !== 'demo' || demoMode));
  const [chosen, setTab] = useSearchParamState<SettingsTab>('tab', 'review', SETTINGS_TABS);
  const tab = shown.includes(chosen) ? chosen : 'review';
  const { hash } = useLocation();
  useEffect(() => {
    const old = OLD_ANCHORS[hash.slice(1)];
    if (old) setTab(old);
    // Only an address arriving with an old anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  return (
    <div>
      <PageHeading eyebrow="Administration" title="Settings" />
      <Tabs label="Settings" controls="settings-tab" tabs={shown.map((id) => ({ id, label: LABELS[id] }))} selected={tab} onSelect={setTab} />
      {tab !== 'edit-data' && <Notice tone="info">Only administrators can change settings. Everyone on staff can read this page.</Notice>}
      <div id="settings-tab" role="tabpanel" aria-label={LABELS[tab]}>
        <SettingsSection tab={tab} isAdmin={isAdmin} />
      </div>
    </div>
  );
}

function SettingsSection({ tab, isAdmin }: { tab: SettingsTab; isAdmin: boolean }) {
  switch (tab) {
    case 'review':
      return (
        <section className="settings-section">
          <h2>Invoice review</h2>
          <div className="settings-columns">
            <ReviewRoutingSettings isAdmin={isAdmin} />
            <DecisionReasonSettings isAdmin={isAdmin} />
          </div>
        </section>
      );
    case 'people':
      return (
        <section className="settings-section">
          <h2>People who use this tool</h2>
          <RoleSummary />
          {isAdmin && <StaffRoleSettings />}
        </section>
      );
    case 'rates':
      return <RatesSection isAdmin={isAdmin} />;
    case 'preauthorization':
      return (
        <section className="settings-section">
          <h2>Pre-authorization thresholds</h2>
          <p className="compact-hint">
            Up to the threshold, a provider's work on a case needs no pre-authorization. Senders must explain going past it, or past what's
            pre-authorized; the invoice is still reviewed.
          </p>
          <PreauthorizationThresholds isAdmin={isAdmin} />
        </section>
      );
    case 'rules':
      return <BillingRulesSettings isAdmin={isAdmin} />;
    case 'providers':
      return (
        <section className="settings-section">
          <h2>Providers</h2>
          <ProvidersSettings isAdmin={isAdmin} />
        </section>
      );
    case 'office-staff':
      return (
        <section className="settings-section">
          <h2>Office billing staff</h2>
          <p className="compact-hint">
            External users who send invoices for an office&apos;s providers. They sign in with a code emailed to them, and only those turned on here
            can sign in. A provider&apos;s own sign-in is under Providers.
          </p>
          <ExternalUserSettings isAdmin={isAdmin} />
        </section>
      );
    case 'duplicates':
      return (
        <section className="settings-section">
          <h2>Merge duplicates</h2>
          <MergeDuplicates />
        </section>
      );
    case 'edit-data':
      return <EditData />;
    case 'demo':
      return <DemoSettings isAdmin={isAdmin} />;
  }
}

function RatesSection({ isAdmin }: { isAdmin: boolean }) {
  const [version, setVersion] = useState(0);
  const { data, error } = useResource(professionalKinds, { resetKey: version });
  const refresh = () => setVersion((v) => v + 1);
  return (
    <section className="settings-section">
      <h2>Rates</h2>
      <p className="compact-hint">
        Time is invoiced at the hourly rate for each kind of professional on the date of the work. Travel and waiting time use their settings
        below, and mileage uses the rate per mile on the date of the trip. A rate set for a provider takes the place of these for them.
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
  );
}
