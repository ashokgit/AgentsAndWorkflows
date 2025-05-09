import React, { useEffect, useState, useRef, useCallback } from 'react';
import BaseNode from './BaseNode';
import WebhookIcon from '@mui/icons-material/Webhook';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import SaveIcon from '@mui/icons-material/Save';
import Badge from '@mui/material/Badge';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import Chip from '@mui/material/Chip';
import axios from 'axios';

function WebhookInputNode(props) {
    // Track if we've already seen the data
    const [hasProcessedData, setHasProcessedData] = useState(!!props.data?.dataLoaded);
    const [updateTime, setUpdateTime] = useState(
        props.data?.last_payload ? Date.now() : null
    );
    const [showLoader, setShowLoader] = useState(false);
    const [needsSave, setNeedsSave] = useState(false);
    const [isCheckingData, setIsCheckingData] = useState(false);
    const [isInTestMode, setIsInTestMode] = useState(false);
    const [lastRunId, setLastRunId] = useState(props.data?.lastRunId || null);

    // Ref to keep the latest payload JSON string for comparison
    const lastPayloadJsonRef = useRef(
        props.data?.last_payload ? JSON.stringify(props.data.last_payload) : ''
    );

    // Check if the webhook is properly configured and has data
    const isConfigured = !!props.data?.webhook_id;
    const hasPayload = !!props.data?.last_payload;
    const isWaitingForData = props.data?.status === 'Waiting';

    // Reset state when entering a new test run
    useEffect(() => {
        // If the node transitions to Waiting status and it's a new run,
        // we need to reset the data indicators
        if (isWaitingForData && props.data?.runId && props.data.runId !== lastRunId) {
            console.log("New test run detected, resetting webhook node state", props.data.runId);
            setLastRunId(props.data.runId);
            setHasProcessedData(false);
            setUpdateTime(null);

            // Tell parent component to clear previous payload data during test
            if (props.updateNodeData && props.data.last_payload) {
                props.updateNodeData(props.id, {
                    last_payload: null,
                    dataLoaded: false,
                    lastRunId: props.data.runId
                });
            }
        }
    }, [isWaitingForData, props.data?.runId, lastRunId, props.id, props.updateNodeData, props.data?.last_payload]);

    // Effect to detect when node is in test mode waiting
    useEffect(() => {
        // Detect if we're in a test run and waiting for webhook data
        if (props.data?.status === 'Waiting') {
            setIsInTestMode(true);
        } else if (isInTestMode && props.data?.status && props.data?.status !== 'Waiting') {
            // Once we were waiting but now have a different status, reset the test mode flag
            setIsInTestMode(false);
        }
    }, [props.data?.status, isInTestMode]);

    // Effect to detect if this is a newly added webhook that needs saving
    useEffect(() => {
        // If there's no webhook_id, this is either a newly added node or saved but not registered
        if (!isConfigured) {
            setNeedsSave(true);
        } else {
            setNeedsSave(false);

            // If we have a webhook_id but no data yet, try to fetch it
            if (!hasPayload && !isCheckingData) {
                checkForWebhookData();
            }
        }
    }, [isConfigured, hasPayload]);

    // Effect to detect dataLoaded flag
    useEffect(() => {
        if (props.data?.dataLoaded && showLoader) {
            console.log("WebhookInputNode: dataLoaded flag detected, stopping loader");
            setShowLoader(false);
            setHasProcessedData(true);
        }
    }, [props.data?.dataLoaded, showLoader]);

    // Function to check if there's data for this webhook ID
    const checkForWebhookData = async () => {
        if (!isConfigured || hasPayload || isCheckingData) return;

        try {
            setIsCheckingData(true);
            console.log(`Checking for webhook data for ID: ${props.data.webhook_id}`);

            // Get webhook debug info
            const response = await axios.get('/api/webhooks/debug');
            const webhookData = response.data;

            // Check if there's data for this webhook ID
            if (webhookData.webhook_payloads && webhookData.webhook_payloads[props.data.webhook_id]) {
                console.log(`Found data for webhook ID: ${props.data.webhook_id}`,
                    webhookData.webhook_payloads[props.data.webhook_id]);

                // Update the node with the data
                if (props.updateNodeData) {
                    props.updateNodeData(props.id, {
                        last_payload: webhookData.webhook_payloads[props.data.webhook_id],
                        dataLoaded: true
                    });
                } else {
                    console.warn("updateNodeData function not available - cannot update node data");
                }
            } else {
                // Look for any webhook mappings for this node ID
                const nodeWebhooks = Object.entries(webhookData.webhook_mappings || {})
                    .filter(([, mapping]) => mapping.node_id === props.id)
                    .map(([webhookId, mapping]) => ({
                        webhookId,
                        payload: webhookData.webhook_payloads?.[webhookId]
                    }))
                    .filter(entry => entry.payload);

                if (nodeWebhooks.length > 0) {
                    console.log(`Found webhook payloads for node ID ${props.id}:`, nodeWebhooks);

                    // Use the first available payload
                    if (props.updateNodeData) {
                        props.updateNodeData(props.id, {
                            last_payload: nodeWebhooks[0].payload,
                            // Update webhook_id if it's different
                            webhook_id: props.data.webhook_id || nodeWebhooks[0].webhookId,
                            dataLoaded: true
                        });
                    }
                } else {
                    console.log(`No webhook data found for webhook ID ${props.data.webhook_id} or node ID ${props.id}`);
                }
            }
        } catch (error) {
            console.error("Error checking webhook data:", error);
        } finally {
            setIsCheckingData(false);
        }
    };

    // Calculate node status based on current state
    const calculateStatus = useCallback(() => {
        if (needsSave) return 'error'; // Workflow needs to be saved first
        if (!isConfigured) return 'error'; // Webhook not configured
        if (isWaitingForData) return 'warning'; // Waiting for webhook data during test
        if (hasPayload && !isWaitingForData) return 'success'; // Has data and not waiting
        return 'idle'; // Waiting for data
    }, [isConfigured, hasPayload, needsSave, isWaitingForData]);

    const [nodeStatus, setNodeStatus] = useState(() => calculateStatus());

    // Effect to detect changes in webhook data
    useEffect(() => {
        // Update node status based on current state
        setNodeStatus(calculateStatus());

        // Check if data was explicitly marked as loaded from the configuration panel
        if (props.data?.dataLoaded) {
            setShowLoader(false);
            setHasProcessedData(true);
            return;
        }

        // Get current payload JSON string
        const currentPayloadStr = props.data?.last_payload
            ? JSON.stringify(props.data.last_payload)
            : '';

        // Data has changed
        const dataChanged = currentPayloadStr !== lastPayloadJsonRef.current;

        // If there's data and it has changed
        if (hasPayload && dataChanged) {
            console.log("WebhookInputNode: New webhook data detected", currentPayloadStr);
            setUpdateTime(Date.now());
            lastPayloadJsonRef.current = currentPayloadStr;
            setShowLoader(true);
            setNodeStatus('pending');

            // Show loader briefly and then show success
            const timer = setTimeout(() => {
                setShowLoader(false);
                setNodeStatus('success');
                setHasProcessedData(true);

                // Update the dataLoaded flag in the node data
                if (props.updateNodeData) {
                    props.updateNodeData(props.id, { dataLoaded: true });
                }
            }, 1500);

            return () => clearTimeout(timer);
        }
        // If we have payload data but haven't processed it yet, mark as processed
        else if (hasPayload && !hasProcessedData) {
            setHasProcessedData(true);
            setUpdateTime(updateTime || Date.now());
        }
    }, [props.data?.last_payload, props.data?.webhook_id, props.data?.dataLoaded, isConfigured,
        hasPayload, hasProcessedData, updateTime, calculateStatus, props.updateNodeData, props.id]);

    // Format message text for each state
    const getStatusMessage = useCallback(() => {
        if (needsSave) return "Workflow must be saved to register webhook";
        if (!isConfigured) return "Webhook not configured. Save your workflow.";
        if (isWaitingForData) return "Waiting for webhook data during test";
        if (hasPayload && !isWaitingForData) return `Data received: ${updateTime ? new Date(updateTime).toLocaleTimeString() : 'Unknown time'}`;
        return "Waiting for webhook data";
    }, [needsSave, isConfigured, hasPayload, updateTime, isWaitingForData]);

    // Create modified props with status and validation message
    const nodeProps = {
        ...props,
        data: {
            ...props.data,
            // Don't need to set label since BaseNode will use webhook_name directly
            status: nodeStatus,
            // Add validation message/error for the BaseNode tooltip
            validationError: needsSave ? "Save workflow to register webhook" :
                (!isConfigured ? "Webhook not configured" : null),
            // Add tooltip text for data status
            validationMessage: getStatusMessage()
        }
    };

    return (
        <BaseNode {...nodeProps}>
            <Box sx={{ display: 'flex', alignItems: 'center', position: 'relative', width: '100%' }}>
                {isWaitingForData ? (
                    <Badge
                        overlap="circular"
                        badgeContent={
                            <NotificationsActiveIcon
                                color="warning"
                                sx={{
                                    fontSize: '14px',
                                    animation: 'pulse 1.5s infinite',
                                    '@keyframes pulse': {
                                        '0%': { opacity: 0.6 },
                                        '50%': { opacity: 1 },
                                        '100%': { opacity: 0.6 },
                                    }
                                }}
                            />
                        }
                    >
                        <WebhookIcon
                            fontSize="small"
                            color="warning"
                        />
                    </Badge>
                ) : (
                    <WebhookIcon
                        fontSize="small"
                        color={hasPayload ? "primary" : "inherit"}
                    />
                )}

                {needsSave && (
                    <SaveIcon
                        fontSize="small"
                        color="error"
                        sx={{ ml: 0.5, fontSize: '16px' }}
                    />
                )}

                {!needsSave && !isConfigured && (
                    <ErrorIcon
                        fontSize="small"
                        color="error"
                        sx={{ ml: 0.5, fontSize: '16px' }}
                    />
                )}

                {isConfigured && !hasPayload && !showLoader && !isWaitingForData && (
                    <HourglassEmptyIcon
                        fontSize="small"
                        color="disabled"
                        sx={{ ml: 0.5, fontSize: '16px' }}
                    />
                )}

                {showLoader && !(props.data?.dataLoaded) && (
                    <CircularProgress
                        size={16}
                        thickness={4}
                        sx={{ ml: 0.5 }}
                        color="success"
                    />
                )}

                {((hasPayload && !showLoader && !isWaitingForData) || (props.data?.dataLoaded && !isWaitingForData)) && (
                    <CheckCircleIcon
                        fontSize="small"
                        color="success"
                        sx={{ ml: 0.5, fontSize: '16px' }}
                    />
                )}

                {/* Status chip */}
                <Box sx={{ marginLeft: 'auto' }}>
                    {isWaitingForData && (
                        <Tooltip title="Waiting for webhook data to continue test run. Send data to the webhook URL in the configuration panel.">
                            <Chip
                                label="WAITING FOR DATA"
                                size="small"
                                color="warning"
                                variant="outlined"
                                sx={{
                                    height: '18px',
                                    fontSize: '0.65rem',
                                    fontWeight: 'bold',
                                    animation: 'pulseBg 2s infinite',
                                    '@keyframes pulseBg': {
                                        '0%': { backgroundColor: 'rgba(255, 152, 0, 0.1)' },
                                        '50%': { backgroundColor: 'rgba(255, 152, 0, 0.3)' },
                                        '100%': { backgroundColor: 'rgba(255, 152, 0, 0.1)' },
                                    }
                                }}
                            />
                        </Tooltip>
                    )}
                    {hasPayload && !isWaitingForData && (
                        <Tooltip title={`Data received at ${updateTime ? new Date(updateTime).toLocaleTimeString() : 'unknown time'}`}>
                            <Chip
                                label="DATA RECEIVED"
                                size="small"
                                color="success"
                                variant="outlined"
                                sx={{
                                    height: '18px',
                                    fontSize: '0.65rem',
                                    fontWeight: 'bold'
                                }}
                            />
                        </Tooltip>
                    )}
                </Box>
            </Box>
        </BaseNode>
    );
}

export default WebhookInputNode;