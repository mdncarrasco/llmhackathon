function procesarCorreos() {
  var labelName = "PROCESSED";
  var label = getOrCreateLabel(labelName);

  // Buscar hilos en la bandeja de entrada sin etiquetas
  var threads = GmailApp.search('in:inbox -in:trash -in:spam -has:userlabels');

  if (threads.length === 0) {
    Logger.log('No hay nuevos tickets.');
    return;
  }

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var mensajes = thread.getMessages();
    var ultimoMensaje = mensajes[mensajes.length - 1];

    // Determinar la acción a tomar con el último mensaje
    var datos = determinarAccion(ultimoMensaje, mensajes);

    if (datos.Action === 'CREATE') {
      crearTicket(ultimoMensaje);
    } else if (datos.Action === 'RESPOND') {
      procesarHilo(thread);
    } else if (datos.Action === 'CLOSE') {
      cerrarTicket(thread, datos.Reply);
    }

    // Marcar el último mensaje como leído
    ultimoMensaje.markRead();

    // Etiquetar y archivar el hilo
    label.addToThread(thread);
    thread.moveToArchive();
  }
}

function cerrarTicket(thread, despedida) {
  var mensajes = thread.getMessages();
  var ticketID = mensajes[0].getId();

  // Actualizar el estado del ticket a 'CLOSED'
  actualizarEstadoTicket(ticketID, 'CLOSED', mensajes.length);

  enviarCorreoRespuesta(mensajes[0].getFrom(), despedida, mensajes[0].getSubject());

  Logger.log('El ticket con ID ' + ticketID + ' ha sido cerrado.');
}


function determinarAccion(ultimoMensaje, mensajes) {
  var esNuevoTicket = mensajes.length === 1;
  var contenidoMensaje = ultimoMensaje.getPlainBody();

  // Si es el primer mensaje del hilo, es un nuevo ticket
  if (esNuevoTicket) {
    return {
      "Action": "CREATE",
      "Reply": "Crea un mensaje de cierre y agradecimiento en el mismo idioma que el mensaje"
    };
  } else {
    // Analizar el contenido del último mensaje para determinar si es cierre de ticket
    var datos = analizarCierreTicket(contenidoMensaje);

    return datos;
  }
}

function analizarCierreTicket(contenidoCorreo) {
  var apiKey = getApiKey("MISTRAL_API_KEY");

  var url = 'https://api.mistral.ai/v1/chat/completions';

  var archivo = {
    "Action": "Analiza el contenido del mensaje e indica si el usuario quier algunas de estas dos opciones: CLOSE o RESPOND",
    "Reply": "Crea un mensaje de cierre y agradecimiento en el mismo idioma que el mensaje"
  };

  var payload = {
    'model': "mistral-medium", // replace with the appropriate Mistral model
    'response_format': { type: "json_object" },
    'messages': [
      {
        'role': 'system', 'content': `Analiza el contenido del mensaje e indica si el usuario quier algunas de estas dos opciones: CLOSE o RESPOND

Message content:
"${contenidoCorreo}" and complete the JSON object. Action attribute must be CLOSE or RESPOND.`
      },
      { 'role': 'user', 'content': JSON.stringify(archivo) }
    ]
  };

  var options = {
    'method': 'post',
    'contentType': 'application/json',
    'headers': {
      'Authorization': 'Bearer ' + apiKey
    },
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };


  try {
    var response = UrlFetchApp.fetch(url, options);
    var result = JSON.parse(response.getContentText());

    if (result.choices && result.choices.length > 0) {
      var assistantResponse = result.choices[0].message.content;
      var datos = JSON.parse(assistantResponse);
      return datos;
    } else {
      Logger.log('Unexpected response format from Mistral API: ' + JSON.stringify(result));
      return null;
    }
  } catch (e) {
    Logger.log('Error calling Mistral API: ' + e);
    return null;
  }
}


function getOrCreateLabel(labelName) {
  var label = GmailApp.getUserLabelByName(labelName);
  if (label == null) {
    label = GmailApp.createLabel(labelName);
  }
  return label;
}

function crearTicket(mensaje) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = spreadsheet.getSheetByName('Tickets');

  var mensajeCompleto = mensaje.getSubject() + '\n' +
    mensaje.getFrom() + '\n' +
    mensaje.getTo() + '\n' +
    mensaje.getDate() + '\n\n' +
    mensaje.getPlainBody();

  // Obtener el enlace al mensaje
  var mensajeId = mensaje.getId();
  var enlaceMensaje = 'https://mail.google.com/mail/u/0/#inbox/' + mensajeId;

  // Enviar el contenido a Mistral
  var datosExtraidos = extraerDatosConMistral(mensajeCompleto);

  if (datosExtraidos) {
    // Agregar los datos a la hoja de cálculo
    var nuevaFila = hoja.appendRow([
      mensajeId,
      datosExtraidos.Info,
      datosExtraidos.Origin,
      datosExtraidos.Category,
      1,
      datosExtraidos.Created,
      datosExtraidos.Created,
      datosExtraidos.Sender,
      "NEW",
      datosExtraidos.Confidence,
      enlaceMensaje
    ]);

    // Si la categoría no es 'NOTHING TO DO WITH', enviar a CodeGPT
    if (datosExtraidos.Category !== 'NOTHING TO DO WITH') {
      // Enviar el cuerpo del correo a CodeGPT para generar la respuesta definitiva
      var respuestaDefinitiva = obtenerRespuestaCodeGPT(mensaje.getPlainBody());

      if (respuestaDefinitiva) {
        var respuestaHTML = convertirMarkdownAHTML(respuestaDefinitiva);
        // Enviar el correo al usuario con la respuesta definitiva
        enviarCorreoRespuesta(datosExtraidos.SenderEmail || mensaje.getFrom(), respuestaHTML, mensaje.getSubject());

        // Actualizar el estado a 'PENDING' en la hoja de cálculo usando el ID
        actualizarEstadoTicket(mensajeId, 'OPEN', 3);
      }
    } else {
      actualizarEstadoTicket(mensajeId, 'CLOSED', 3);
    }

  } else {
    Logger.log('No se pudieron extraer datos del correo con ID: ' + mensaje.getId());
  }
}

function procesarHilo(thread) {
  var mensajes = thread.getMessages();
  var ticketID = mensajes[0].getId();
  var remitente = mensajes[0].getFrom();
  var contenidoAgregado = '';
  Logger.log('Procesando el hilo con ID: ' + ticketID);

  labelName = "PENDING";
  label = getOrCreateLabel(labelName);
  label.addToThread(thread);

  for (var j = 0; j < mensajes.length; j++) {
    var mensaje = mensajes[j];
    // Acumular el cuerpo del mensaje
    contenidoAgregado += '\n\n' + mensaje.getPlainBody();
    mensaje.markRead();
  }

  // Enviar el contenido agregado a obtenerRespuestaCodeGPT
  var respuestaDefinitiva = obtenerRespuestaCodeGPT(contenidoAgregado);

  if (respuestaDefinitiva) {
    var respuestaHTML = convertirMarkdownAHTML(respuestaDefinitiva);
    // Enviar correo al usuario preguntando si desea cerrar el ticket
    enviarCorreoRespuesta(remitente, respuestaHTML, thread.getFirstMessageSubject());
  }
  actualizarEstadoTicket(ticketID, labelName, mensajes.length + 1);
}

function actualizarEstadoTicket(ticketID, nuevoEstado, cantidadMensajes) {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Tickets');
  var rangoID = hoja.getRange('A:A'); // Columna A donde están los IDs
  var textFinder = rangoID.createTextFinder(ticketID);
  var celdaEncontrada = textFinder.findNext();

  if (celdaEncontrada) {
    var fila = celdaEncontrada.getRow();
    hoja.getRange(fila, 9).setValue(nuevoEstado); // Columna 5 es 'Estado'
    // Actualizar la fecha de actualización
    var fechaActual = new Date();
    hoja.getRange(fila, 7).setValue(fechaActual); // Columna 7 es 'Updated'
    hoja.getRange(fila, 5).setValue(cantidadMensajes);
  } else {
    Logger.log('No se encontró el ticket con ID: ' + ticketID);
  }
}

function enviarCorreoRespuesta(destinatario, contenidoRespuesta, asuntoOriginal) {
  var asuntoRespuesta = 'Re: ' + asuntoOriginal;

  MailApp.sendEmail({
    to: destinatario,
    subject: asuntoRespuesta,
    htmlBody: contenidoRespuesta
  });
}


function extraerDatosConMistral(contenidoCorreo) {
  var apiKey = getApiKey("MISTRAL_API_KEY");

  var url = 'https://api.mistral.ai/v1/chat/completions';

  var archivo = {
    "Language": "Identify the language of the email, from now on you must respond in the identified language",
    "Info": "Create a descriptive title for the ticket the user is requesting",
    "Origin": "Since this ticket comes through Gmail, just put GMAIL. In the future, there will be other channels",
    "Category": "Select which category the ticket belongs to: Create, Improve, Adapt, Modify, NOTHING TO DO WITH",
    "Created": "Creation date in the following format: MMM DD, YYYY",
    "Sender": "Name of the person requesting the ticket or email",
    "Confidence": "Confidence level in related to prompt engineering  (0 to 1)"
  };

  var payload = {
    'model': "mistral-medium", // replace with the appropriate Mistral model
    'response_format': { type: "json_object" },
    'messages': [
      {
        'role': 'system', 'content': `Your task is to extract relevant information from emails related to prompt engineering and return a JSON object with the extracted data. If the request in the email is not related to prompt engineering, set the "Category" attribute to "NOTHING TO DO WITH".

You MUST detect the language of the email and respond in the same language.

Email content:
"${contenidoCorreo}" and complete the JSON object. Make sure you are responding in the same language as the "Language" attribute.`
      },
      { 'role': 'user', 'content': JSON.stringify(archivo) }
    ]
  };

  var options = {
    'method': 'post',
    'contentType': 'application/json',
    'headers': {
      'Authorization': 'Bearer ' + apiKey
    },
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };


  try {
    var response = UrlFetchApp.fetch(url, options);
    var result = JSON.parse(response.getContentText());

    if (result.choices && result.choices.length > 0) {
      var assistantResponse = result.choices[0].message.content;
      var datos = JSON.parse(assistantResponse);
      return datos;
    } else {
      Logger.log('Unexpected response format from Mistral API: ' + JSON.stringify(result));
      return null;
    }
  } catch (e) {
    Logger.log('Error calling Mistral API: ' + e);
    return null;
  }
}

function getApiKey(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function obtenerRespuestaCodeGPT(contenidoCorreo) {
  var apiKey = getApiKey("CODEGPT_API_KEY");
  var agentId = getApiKey("CODEGPT_AGENT_ID");

  const options = {
    method: 'POST',
    contentType: 'application/json',
    headers: {
      accept: 'application/json',
      'authorization': 'Bearer ' + apiKey
    },
    payload: JSON.stringify({
      stream: false,
      agentId: agentId,
      messages: [{ content: contenidoCorreo, role: 'user' }],
      format: 'json'
    })
  };

  const url = 'https://api.codegpt.co/api/v1/chat/completions';
  try {
    var response = UrlFetchApp.fetch(url, options);
    var result = JSON.parse(response.getContentText());

    if (result.choices && result.choices.length > 0) {
      var assistantResponse = result.choices[0].message.completion;
      return assistantResponse; // Devolvemos la respuesta del asistente
    } else {
      Logger.log('Formato de respuesta inesperado de CodeGPT: ' + JSON.stringify(result));
      return null;
    }
  } catch (e) {
    Logger.log('Error al llamar a la API de CodeGPT: ' + e);
    return null;
  }
}

function convertirMarkdownAHTML(markdown) {
  var converter = new showdown.Converter();
  var html = converter.makeHtml(markdown);
  return html;
}




