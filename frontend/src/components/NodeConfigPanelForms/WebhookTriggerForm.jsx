import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import RefreshIcon from '@mui/icons-material/Refresh';
import SendIcon from '@mui/icons-material/Send';
import Paper from '@mui/material/Paper';
import axios from 'axios'; // For refresh data

const WebhookTriggerForm = ({
    node, // For node.id
    formData,
    setFormData, // To update local state if necessary, or for refresh logic
    commonTextFieldProps,
    workflowId,
    onUpdate, // For refresh and clear data
    waitingForWebhookData, // State from parent
    testDataSending, // State from parent
    handleSendTestData, // Handler from parent
    // No NodeInputSelector or DraggableTextField used here directly in the original code
}) => {

    const webhookId = formData.webhook_id || 'Generating...';
    const workflowIdForPath = workflowId || formData.workflow_id || '';
    const computedWebhookPath = webhookId.includes('/api/webhooks/')
        ? webhookId
        : `/api/webhooks/wh_${workflowIdForPath}_${node.id}`;
    const hasWebhookData = !!formData.last_payload;
    const needsWorkflowSave = !formData.webhook_id && !workflowId;

    const handleRefreshData = async () => {
        if (needsWorkflowSave) {
            alert("Please save your workflow first to register this webhook.");
            return;
        }

        if (formData.webhook_id && node) {
            try {
                const currentWorkflowId = workflowId ||
                    window.location.pathname.split('/').pop() ||
                    formData.workflow_id;

                if (!currentWorkflowId) {
                    console.error("Could not determine workflow ID for refresh");
                    alert("Could not determine workflow ID. Try saving the workflow first.");
                    return;
                }

                console.log("Manually refreshing webhook data for workflow:", currentWorkflowId);
                const response = await axios.get(`/api/workflows/${currentWorkflowId}`);
                const workflow = response.data;

                if (!workflow || !workflow.nodes) {
                    console.error("No workflow data returned");
                    return;
                }

                const updatedNode = workflow.nodes.find(n => n.id === node.id);
                if (updatedNode && updatedNode.data?.last_payload) {
                    console.log("Found updated webhook data:", updatedNode.data.last_payload);
                    onUpdate(node.id, {
                        last_payload: updatedNode.data.last_payload,
                        dataLoaded: true
                    });
                    // Parent's formData will be updated via onUpdate, no direct setFormData here needed for that
                    // If this component had its own copy of formData for display, then call setFormData here.
                    // Assuming this component relies on parent's formData prop after onUpdate.
                } else {
                    console.log("No webhook data found in updated node");
                    try {
                        const webhookDebugResponse = await axios.get('/api/webhooks/debug');
                        const webhookData = webhookDebugResponse.data;

                        if (formData.webhook_id && webhookData.webhook_payloads[formData.webhook_id]) {
                            console.log("Found data directly in webhook_payloads:",
                                webhookData.webhook_payloads[formData.webhook_id]);
                            onUpdate(node.id, {
                                last_payload: webhookData.webhook_payloads[formData.webhook_id],
                                dataLoaded: true
                            });
                            return;
                        }

                        const webhookEntries = Object.entries(webhookData.webhook_mappings || {})
                            .filter(([, mapping]) => mapping.node_id === node.id)
                            .map(([webhookId]) => webhookId);

                        if (webhookEntries.length > 0) {
                            console.log("Found webhook mappings for this node:", webhookEntries);
                            alert(`Webhook is registered (ID: ${formData.webhook_id}) but no data has been sent to it yet. Try sending data to this webhook URL first.`);
                        } else {
                            console.log("No webhook mappings found for this node");
                            alert(`No webhook data found. Make sure to send data to this webhook URL: ${window.location.origin}${formData.webhook_id.startsWith('/') ? '' : '/'}${formData.webhook_id}`);
                        }
                    } catch (debugError) {
                        console.error("Error fetching webhook debug data:", debugError);
                        alert(`No webhook data found. Try sending data to this webhook URL: ${window.location.origin}${formData.webhook_id.startsWith('/') ? '' : '/'}${formData.webhook_id}`);
                    }
                }
            } catch (error) {
                console.error("Error manually refreshing webhook data:", error);
                alert(`Error refreshing webhook data: ${error.message}`);
            }
        }
    };

    return (
        <>
            <TextField
                label="Webhook Name"
                name="webhook_name"
                value={formData.webhook_name || ''}
                placeholder="Give this webhook a descriptive name"
                {...commonTextFieldProps}
                sx={{ mb: 2 }}
            />

            <Box sx={{ mb: 3, p: 2, backgroundColor: '#f5f5f5', borderRadius: 1 }}>
                <Typography variant="subtitle2" gutterBottom>
                    Webhook URL {formData.webhook_id &&
                        <span style={{
                            backgroundColor: '#4caf50',
                            color: 'white',
                            padding: '2px 8px',
                            borderRadius: '10px',
                            fontSize: '0.75rem',
                            marginLeft: '8px'
                        }}>
                            Ready
                        </span>
                    }
                    {needsWorkflowSave &&
                        <span style={{
                            backgroundColor: '#f44336',
                            color: 'white',
                            padding: '2px 8px',
                            borderRadius: '10px',
                            fontSize: '0.75rem',
                            marginLeft: '8px'
                        }}>
                            Save Required
                        </span>
                    }
                    {waitingForWebhookData &&
                        <span style={{
                            backgroundColor: '#ff9800',
                            color: 'white',
                            padding: '2px 8px',
                            borderRadius: '10px',
                            fontSize: '0.75rem',
                            marginLeft: '8px',
                            animation: 'pulse 1.5s infinite',
                            '@keyframes pulse': {
                                '0%': { opacity: 0.8 },
                                '50%': { opacity: 1 },
                                '100%': { opacity: 0.8 },
                            }
                        }}>
                            Waiting For Data
                        </span>
                    }
                </Typography>
                <Typography
                    sx={{
                        p: 1,
                        backgroundColor: 'background.paper',
                        borderRadius: 1,
                        fontFamily: 'monospace',
                        wordBreak: 'break-all',
                        border: formData.webhook_id ? '1px solid #e0e0e0' : '1px dashed #f44336'
                    }}
                >
                    {formData.webhook_id ?
                        `${window.location.origin}${computedWebhookPath.startsWith('/') ? '' : '/'}${computedWebhookPath}` :
                        'Save your workflow first to generate a webhook URL'
                    }
                </Typography>
                {formData.webhook_id && (
                    <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <Button
                            size="small"
                            variant="outlined"
                            onClick={() => navigator.clipboard.writeText(
                                `${window.location.origin}${computedWebhookPath.startsWith('/') ? '' : '/'}${computedWebhookPath}`
                            )}
                        >
                            Copy URL
                        </Button>
                        <Button
                            size="small"
                            variant="outlined"
                            color="info"
                            onClick={() => window.open(
                                `${window.location.origin}${computedWebhookPath.startsWith('/') ? '' : '/'}${computedWebhookPath}`, '_blank'
                            )}
                        >
                            Open in New Tab
                        </Button>
                        <Button
                            size="small"
                            variant="outlined"
                            color="success"
                            onClick={() => {
                                const webhookPath = computedWebhookPath;
                                const curlCommand = `curl -X POST ${window.location.origin}${webhookPath} -H "Content-Type: application/json" -d '{ "event":"test.event","data":{"user_id":"12345","email":"test@example.com","name":"Test User"},"timestamp":"${new Date().toISOString()}"}'`;
                                navigator.clipboard.writeText(curlCommand);
                                alert("Curl command copied to clipboard. Paste it in your terminal to test the webhook.");
                            }}
                        >
                            Copy Test Command
                        </Button>
                    </Box>
                )}
            </Box>

            {waitingForWebhookData && (
                <Box sx={{
                    mb: 3,
                    p: 2,
                    borderRadius: 1,
                    border: '2px solid #ff9800',
                    backgroundColor: 'rgba(255, 152, 0, 0.1)',
                    animation: 'pulseBorder 2s infinite',
                    '@keyframes pulseBorder': {
                        '0%': { boxShadow: '0 0 0 0 rgba(255, 152, 0, 0.4)' },
                        '70%': { boxShadow: '0 0 0 6px rgba(255, 152, 0, 0)' },
                        '100%': { boxShadow: '0 0 0 0 rgba(255, 152, 0, 0)' },
                    }
                }}>
                    <Typography variant="subtitle2" sx={{
                        display: 'flex',
                        alignItems: 'center',
                        color: '#e65100',
                        mb: 1
                    }}>
                        <CircularProgress size={16} thickness={4} sx={{ mr: 1 }} color="warning" />
                        Workflow Execution Paused
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                        The workflow is waiting for data to be sent to this webhook. You can:
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Button
                            variant="contained"
                            color="warning"
                            size="medium"
                            disabled={testDataSending}
                            onClick={handleSendTestData} // Passed from parent
                            startIcon={testDataSending ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
                            sx={{ fontWeight: 'bold' }}
                        >
                            {testDataSending ? 'Sending...' : 'Send Test Data Now'}
                        </Button>
                        <Typography variant="caption" sx={{ textAlign: 'center', color: 'text.secondary' }}>
                            This will send test data to the webhook and continue workflow execution
                        </Typography>
                    </Box>
                </Box>
            )}

            {/* Last Received Payload section moved to the right panel in NodeConfigPanel.jsx
            <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center' }}>
                    Last Received Payload
                    {hasWebhookData ?
                        <span style={{
                            backgroundColor: '#4caf50',
                            color: 'white',
                            padding: '2px 8px',
                            borderRadius: '10px',
                            fontSize: '0.75rem',
                            marginLeft: '8px'
                        }}>
                            Data Received
                        </span> :
                        <span style={{
                            backgroundColor: '#9e9e9e',
                            color: 'white',
                            padding: '2px 8px',
                            borderRadius: '10px',
                            fontSize: '0.75rem',
                            marginLeft: '8px'
                        }}>
                            {needsWorkflowSave ? 'Save Required' : 'Waiting'}
                        </span>
                    }
                </Typography>

                <Box
                    sx={{
                        p: 2,
                        backgroundColor: '#f5f5f5',
                        borderRadius: 1,
                        mb: 2,
                        mt: 2,
                        maxHeight: '300px',
                        overflow: 'auto',
                        border: hasWebhookData ? '1px solid #e0e0e0' :
                            (needsWorkflowSave ? '1px dashed #f44336' : '1px dashed #9e9e9e')
                    }}
                >
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                        {formData.last_payload ?
                            JSON.stringify(formData.last_payload, null, 2) :
                            (needsWorkflowSave ?
                                'Save your workflow first to register webhook and receive data.' :
                                'No data received yet. Send a webhook to this URL to see the payload.')
                        }
                    </pre>
                </Box>

                <Paper
                    elevation={1}
                    sx={{
                        mt: 1,
                        p: 1,
                        bgcolor: needsWorkflowSave ? '#fff0f0' : '#f0f4ff',
                        borderRadius: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        border: needsWorkflowSave ? '1px dashed #f44336' : '1px dashed #2196f3',
                        marginBottom: '10px'
                    }}
                >
                    <Typography variant="caption" sx={{
                        fontWeight: 'bold',
                        color: needsWorkflowSave ? '#d32f2f' : '#1976d2'
                    }}>
                        <span role="img" aria-label="info">
                            {needsWorkflowSave ? '⚠️' : 'ℹ️'}
                        </span>
                        {needsWorkflowSave
                            ? ' Save workflow to register webhook and enable data reception'
                            : ' External webhook data may need a manual refresh'
                        }
                    </Typography>
                </Paper>

                <Button
                    variant="outlined"
                    color="info"
                    size="small"
                    startIcon={<RefreshIcon />}
                    onClick={handleRefreshData}
                    disabled={!formData.webhook_id && !needsWorkflowSave}
                    sx={{ mr: 1 }}
                >
                    {needsWorkflowSave ? 'Save Workflow First' : 'Refresh Data'}
                </Button>

                {hasWebhookData && (
                    <Button
                        variant="outlined"
                        color="warning"
                        size="small"
                        onClick={() => {
                            if (window.confirm("Clear the current webhook data?")) {
                                onUpdate(node.id, { last_payload: null });
                                // Parent will update formData prop, no need for setFormData here for this action
                            }
                        }}
                    >
                        Clear Data
                    </Button>
                )}
            </Box>
            */}

            {/* How to Use Webhook Data section moved to the right panel in NodeConfigPanel.jsx
            <Typography variant="subtitle2" gutterBottom>
                How to Use Webhook Data
            </Typography>
            <Box sx={{ p: 2, backgroundColor: '#e3f2fd', borderRadius: 1, fontSize: '0.875rem' }}>
                <p style={{ margin: '0 0 8px 0' }}>After receiving data, you can reference it in subsequent nodes:</p>
                <ul style={{ margin: 0, paddingLeft: '20px' }}>
                    <li>The entire payload is passed to the next node</li>
                    <li>Access specific fields using dot notation in code nodes</li>
                    <li>Example: <code>input_data.sample_data.number_value</code></li>
                </ul>
            </Box>
            */}
        </>
    );
};

export default WebhookTriggerForm; 