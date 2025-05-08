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
import axios from 'axios';

function WebhookInputNode(props) {
    // Track if we've already seen the data
    const [hasProcessedData, setHasProcessedData] = useState(false);
    const [updateTime, setUpdateTime] = useState(
        props.data?.last_payload ? Date.now() : null
    );
    const [showLoader, setShowLoader] = useState(false);
    const [needsSave, setNeedsSave] = useState(false);
    const [isCheckingData, setIsCheckingData] = useState(false);

    // Ref to keep the latest payload JSON string for comparison
    const lastPayloadJsonRef = useRef(
        props.data?.last_payload ? JSON.stringify(props.data.last_payload) : ''
    );

    // Check if the webhook is properly configured and has data
    const isConfigured = !!props.data?.webhook_id;
    const hasPayload = !!props.data?.last_payload;

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
                        last_payload: webhookData.webhook_payloads[props.data.webhook_id]
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
                            webhook_id: props.data.webhook_id || nodeWebhooks[0].webhookId
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
        if (hasPayload) return 'success'; // Has data
        return 'idle'; // Waiting for data
    }, [isConfigured, hasPayload, needsSave]);

    const [nodeStatus, setNodeStatus] = useState(() => calculateStatus());

    // Effect to detect changes in webhook data
    useEffect(() => {
        // Update node status based on current state
        setNodeStatus(calculateStatus());

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
            }, 1500);

            return () => clearTimeout(timer);
        }
        // If we have payload data but haven't processed it yet, mark as processed
        else if (hasPayload && !hasProcessedData) {
            setHasProcessedData(true);
            setUpdateTime(updateTime || Date.now());
        }
    }, [props.data?.last_payload, props.data?.webhook_id, isConfigured,
        hasPayload, hasProcessedData, updateTime, calculateStatus]);

    // Format message text for each state
    const getStatusMessage = useCallback(() => {
        if (needsSave) return "Workflow must be saved to register webhook";
        if (!isConfigured) return "Webhook not configured. Save your workflow.";
        if (hasPayload) return `Data received: ${updateTime ? new Date(updateTime).toLocaleTimeString() : 'Unknown time'}`;
        return "Waiting for webhook data";
    }, [needsSave, isConfigured, hasPayload, updateTime]);

    // Create modified props with status and validation message
    const nodeProps = {
        ...props,
        data: {
            ...props.data,
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
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <WebhookIcon
                    fontSize="small"
                    color={hasPayload ? "primary" : "inherit"}
                />

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

                {isConfigured && !hasPayload && !showLoader && (
                    <HourglassEmptyIcon
                        fontSize="small"
                        color="disabled"
                        sx={{ ml: 0.5, fontSize: '16px' }}
                    />
                )}

                {showLoader && (
                    <CircularProgress
                        size={16}
                        thickness={4}
                        sx={{ ml: 0.5 }}
                        color="success"
                    />
                )}

                {hasPayload && !showLoader && (
                    <CheckCircleIcon
                        fontSize="small"
                        color="success"
                        sx={{ ml: 0.5, fontSize: '16px' }}
                    />
                )}
            </Box>
        </BaseNode>
    );
}

export default WebhookInputNode;