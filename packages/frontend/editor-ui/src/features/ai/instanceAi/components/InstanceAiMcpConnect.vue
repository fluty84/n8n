<script lang="ts" setup>
/**
 * Transport adapter around `InstanceAiMcpConnectCard`, in the shape of
 * `InstanceAiChannelSetup.vue`. Unlike that one the card is NOT unmounted after
 * resolving — it stays in the transcript in its resolved state.
 */
import { computed, ref } from 'vue';
import { useTelemetry } from '@n8n/composables/useTelemetry';
import { useRootStore } from '@n8n/stores/useRootStore';
import type { InstanceAiMcpConnectServer } from '@n8n/api-types';

import { useThread } from '../instanceAi.store';
import InstanceAiMcpConnectCard from './InstanceAiMcpConnectCard.vue';

const props = defineProps<{
	requestId: string;
	inputThreadId?: string;
	servers: InstanceAiMcpConnectServer[];
	readOnly?: boolean;
	expired?: boolean;
}>();

const thread = useThread();
const telemetry = useTelemetry();
const rootStore = useRootStore();

const MAX_CONFIRM_ATTEMPTS = 2;

const submitted = ref(false);

const isResolved = computed(
	() =>
		submitted.value ||
		Boolean(props.readOnly) ||
		thread.resolvedConfirmationIds.has(props.requestId),
);

async function onResolve({
	approved,
	connectedSlugs,
}: {
	approved: boolean;
	connectedSlugs: string[];
}) {
	if (isResolved.value) return;
	submitted.value = true;

	telemetry.track('User finished providing input', {
		thread_id: thread.id,
		input_thread_id: props.inputThreadId ?? '',
		instance_id: rootStore.instanceId,
		type: 'mcp-connect',
		provided_inputs: approved
			? [
					{
						label: 'mcp-connect',
						options: props.servers.map((server) => server.serverSlug),
						option_chosen: connectedSlugs,
					},
				]
			: [],
		skipped_inputs: approved
			? []
			: [{ label: 'mcp-connect', options: props.servers.map((server) => server.serverSlug) }],
	});

	for (let attempt = 0; attempt < MAX_CONFIRM_ATTEMPTS; attempt++) {
		if (
			await thread.confirmAction(props.requestId, { kind: 'mcpConnect', approved, connectedSlugs })
		) {
			break;
		}
	}
	thread.resolveConfirmation(props.requestId, approved ? 'approved' : 'deferred');
}
</script>

<template>
	<InstanceAiMcpConnectCard
		:servers="servers"
		:read-only="isResolved"
		:expired="expired"
		@resolve="onResolve"
	/>
</template>
