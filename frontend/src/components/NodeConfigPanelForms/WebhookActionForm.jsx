import React from 'react';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';

// Assuming NodeInputSelector and DraggableTextField are passed as props

const WebhookActionForm = ({
    formData,
    nodes,
    edges, // For NodeInputSelector
    commonTextFieldProps,
    fieldErrors,
    jsonValidity, // For headers and body validation
    NodeInputSelector, // Passed as prop
    DraggableTextField, // Passed as prop
    // handleChange & handleBlur are in commonTextFieldProps
}) => {
    return (
        <>
            <NodeInputSelector node={{ data: formData, type: 'webhook_action', id: formData.id }} nodes={nodes} edges={edges} />

            <TextField
                label="Name"
                name="node_name"
                value={formData.node_name || ''}
                placeholder="Give this webhook a descriptive name"
                {...commonTextFieldProps}
            />

            <TextField
                label="Webhook URL"
                name="url"
                type="url"
                required
                value={formData.url || ''}
                error={!!fieldErrors.url}
                helperText={fieldErrors.url}
                {...commonTextFieldProps}
            />
            <FormControl fullWidth margin="normal" size="small">
                <InputLabel id="method-select-label">HTTP Method</InputLabel>
                <Select
                    labelId="method-select-label"
                    label="HTTP Method"
                    name="method"
                    value={formData.method || 'POST'}
                    onChange={commonTextFieldProps.onChange}
                    onBlur={commonTextFieldProps.onBlur}
                >
                    <MenuItem value="POST">POST</MenuItem>
                    <MenuItem value="GET">GET</MenuItem>
                    <MenuItem value="PUT">PUT</MenuItem>
                    <MenuItem value="DELETE">DELETE</MenuItem>
                    <MenuItem value="PATCH">PATCH</MenuItem>
                </Select>
            </FormControl>
            <DraggableTextField
                label="Headers (JSON)"
                name="headers"
                multiline
                rows={4}
                value={formData.headers || '{}'}
                error={!jsonValidity.headers || !!fieldErrors.headers}
                helperText={!jsonValidity.headers ? 'Invalid JSON' : fieldErrors.headers}
                InputProps={{ sx: { fontFamily: 'monospace' } }}
                {...commonTextFieldProps}
            />
            <DraggableTextField
                label="Body (JSON)"
                name="body"
                multiline
                rows={6}
                value={formData.body || ''}
                error={!jsonValidity.body || !!fieldErrors.body}
                helperText={!jsonValidity.body ? 'Invalid JSON' : fieldErrors.body || 'Defaults to node input if blank. Drag node outputs to create a custom body.'}
                placeholder={'{ "key": "value" } '}
                InputProps={{ sx: { fontFamily: 'monospace' } }}
                {...commonTextFieldProps}
            />
        </>
    );
};

export default WebhookActionForm; 