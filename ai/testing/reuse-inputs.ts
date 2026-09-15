/** Small in-memory capability declarations for resolver behavior tests. */
import type { FrameworkIndex } from '../knowledge/index';
import type { PageKnowledge } from '../knowledge/page-knowledge';
import { measurement, targetEvidence } from './synthetic-data';

export function reuseInputs() {
  const expression = 'page.locator("#contract_control")';
  const index = { pages: { ContractPage: { methods: [{ name: 'control', params: [] }, { name: 'other', params: [] }] } },
    fixtures: ['contractPage', 'page', 'step'], support: {} } as unknown as FrameworkIndex;
  const knowledge = [{ file: 'synthetic-contract.yaml', route: '/contract', elements: [{ id: 'control',
    page_object: 'ContractPage', page_object_method: 'control', locator_strategy: expression }] }] as unknown as PageKnowledge[];
  const evidence = targetEvidence(expression, { derivedCandidates: [
    measurement('page.getByRole("button", { name: "Higher ranked raw control", exact: true })'), measurement(expression),
  ] });
  return { expression, index, knowledge, evidence };
}
