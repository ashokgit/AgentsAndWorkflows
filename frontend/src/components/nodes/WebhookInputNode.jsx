import React, { useEffect, useState, useRef, useCallback } from 'react';
import BaseNode from './BaseNode';
import WebhookIcon from '@mui/icons-material/Webhook';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import PendingIcon from '@mui/icons-material/Pending';

function WebhookInputNode(props) {
    // Track if we've already seen the data
    const [hasProcessedData, setHasProcessedData] = useState(false);
    const [updateTime, setUpdateTime] = useState(
        props.data?.last_payload ? Date.now() : null
    );
    const [showLoader, setShowLoader] = useState(false);

    // Ref to keep the latest payload JSON string for comparison
    const lastPayloadJsonRef = useRef(
        props.data?.last_payload ? JSON.stringify(props.data.last_payload) : ''
    );

    // Check if the webhook is properly configured and has data
    const isConfigured = !!props.data?.webhook_id;
    const hasPayload = !!props.data?.last_payload;

    // Calculate node status based on current state
    const calculateStatus = useCallback(() => {
        if (!isConfigured) return 'error';
        if (hasPayload) return 'success';
        return 'idle';
    }, [isConfigured, hasPayload]);

    const [nodeStatus, setNodeStatus] = useState(() => calculateStatus());

    // Effect to detect changes in webhook data
    useEffect(() => {
        // Get current payload JSON string
        const currentPayloadStr = props.data?.last_payload
            ? JSON.stringify(props.data.last_payload)
            : '';

        // Data has changed
        const dataChanged = currentPayloadStr !== lastPayloadJsonRef.current;

        // If there's data and it has changed
        if (hasPayload && dataChanged) {
            console.log("WebhookInputNode: New webhook data detected");
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
        // Make sure we update status appropriately
        else {
            setNodeStatus(calculateStatus());
            // If we have payload data but haven't processed it yet, mark as processed
            if (hasPayload && !hasProcessedData) {
                setHasProcessedData(true);
                setUpdateTime(updateTime || Date.now());
            }
        }
    }, [props.data?.last_payload, props.data?.webhook_id, isConfigured,
        hasPayload, hasProcessedData, updateTime, calculateStatus]);

    // Format updateTime to show when data was last updated
    const lastUpdateText = !isConfigured
        ? "Webhook not configured. Save your workflow."
        : hasPayload
            ? `Data received: ${updateTime ? new Date(updateTime).toLocaleTimeString() : 'Unknown time'}`
            : "Waiting for webhook data";

    // Create modified props with status
    const nodeProps = {
        ...props,
        data: {
            ...props.data,
            status: nodeStatus
        }
    };

    // Determine which icon to show (only one at a time)
    const renderStatusIcon = () => {
        // Priority order: Loader > Error > Success > Waiting
        if (showLoader) {
            return (
                <CircularProgress
                    size={24}
                    thickness={2}
                    sx={{
                        position: 'absolute',
                        top: -4,
                        left: -4,
                        color: '#4caf50'
                    }}
                />
            );
        } else if (!isConfigured) {
            return (
                <ErrorIcon
                    fontSize="small"
                    sx={{
                        position: 'absolute',
                        top: -4,
                        right: -4,
                        color: '#f44336'
                    }}
                />
            );
        } else if (hasPayload) {
            return (
                <CheckCircleIcon
                    fontSize="small"
                    sx={{
                        position: 'absolute',
                        top: -4,
                        left: -4,
                        color: '#4caf50'
                    }}
                />
            );
        } else {
            return (
                <PendingIcon
                    fontSize="small"
                    sx={{
                        position: 'absolute',
                        top: -4,
                        right: -4,
                        color: '#9e9e9e'
                    }}
                />
            );
        }
    };

    return (
        <BaseNode {...nodeProps}>
            <Tooltip title={lastUpdateText}>
                <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                    <WebhookIcon
                        fontSize="small"
                        color={hasPayload ? "primary" : "inherit"}
                    />
                    {renderStatusIcon()}
                </Box>
            </Tooltip>
        </BaseNode>
    );
}

export default WebhookInputNode;