import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/vue';
import { createComponentRenderer } from '@/__tests__/render';
import ConnectionRow from '../ConnectionRow.vue';

vi.mock('@n8n/i18n', async (importOriginal) => ({
	...(await importOriginal()),
	useI18n: () => ({ baseText: (key: string) => key }),
}));

const renderComponent = createComponentRenderer(ConnectionRow);

const baseProps = {
	name: 'Brave',
	subtitle: 'Search the web',
	icon: 'plug' as const,
	status: 'disconnected' as const,
	actions: [],
};

describe('ConnectionRow', () => {
	it('emits connect from the primary action without opening settings', async () => {
		const { getByTestId, emitted } = renderComponent({
			props: { ...baseProps, primaryActionLabel: 'Connect' },
		});

		await fireEvent.click(getByTestId('instance-ai-connection-row-primary-action'));

		expect(emitted().connect).toHaveLength(1);
		expect(emitted().openSettings).toBeUndefined();
	});

	it('does not open settings when clicking a row with a primary action', async () => {
		const { getByText, emitted } = renderComponent({
			props: { ...baseProps, primaryActionLabel: 'Connect' },
		});

		await fireEvent.click(getByText('Brave'));

		expect(emitted().openSettings).toBeUndefined();
	});

	it('opens settings on row click without a primary action', async () => {
		const { getByText, emitted } = renderComponent({ props: baseProps });

		await fireEvent.click(getByText('Brave'));

		expect(emitted().openSettings).toHaveLength(1);
	});

	it('spells out the status when asked to', () => {
		const { getByText } = renderComponent({
			props: { ...baseProps, status: 'connected' as const, showStatusLabel: true },
		});

		expect(getByText('instanceAi.connections.row.status.connected')).toBeVisible();
	});

	it('leaves the status to the tooltip by default', () => {
		const { queryByText } = renderComponent({
			props: { ...baseProps, status: 'connected' as const },
		});

		expect(queryByText('instanceAi.connections.row.status.connected')).toBeNull();
	});
});
